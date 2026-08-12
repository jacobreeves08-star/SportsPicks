import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, league, leagueMember, leagueMemberReport, leagueInviteCode, pick, user } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { containsDisallowedContent } from "../lib/content-filter.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/http-errors.js";
import { generateInviteCode, isUniqueConstraintViolation } from "../lib/invite-code.js";
import { requireLeagueCommissioner, requireLeagueMembership, requireOwnMembership } from "../lib/authorization.js";
import { rejectionToApiError, writePick } from "../lib/pick-write.js";
import { ESPN_SPORT_SLUGS } from "../lib/sports-provider.js";
import { isValidIanaTimeZone, nowUtc } from "../lib/time.js";

const MEMBERS_PAGE_DEFAULT_LIMIT = 25;
const MEMBERS_PAGE_MAX_LIMIT = 100;

function encodeCursor(joinedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ joinedAt: joinedAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(cursor: string): { joinedAt: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "joinedAt" in parsed &&
      "id" in parsed &&
      typeof parsed.joinedAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { joinedAt: parsed.joinedAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

async function insertInviteCodeWithRetry(tx: typeof db, leagueId: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const [created] = await tx.insert(leagueInviteCode).values({ leagueId, code: generateInviteCode() }).returning();
      return created!;
    } catch (err) {
      if (attempt === 5 || !isUniqueConstraintViolation(err)) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Sports-selection freeze (JAC-25-30, confirmed hard-freeze with the
 * user): once a league has a graded game, `sports` becomes immutable.
 * The explicit AT TIME ZONE cast matters — comparing timestamptz to a
 * bare `date` without it resolves using the DB session's timezone, not
 * the league's, which is exactly the per-viewer-timezone ambiguity
 * league.timezone exists to eliminate (see docs/leagues-and-membership.md).
 */
async function isSportsSelectionFrozen(leagueRow: typeof league.$inferSelect): Promise<boolean> {
  // NOTE: drizzle's sql tag flattens a JS array interpolated directly
  // into an IN-list (multiple $n placeholders), not a single bound
  // Postgres array — `= any(${array})` binds only the array's first
  // element and breaks. sql.join(...) is the correct way to build an
  // IN-list of individually-parameterized values.
  const sportsSql = sql.join(
    leagueRow.sports.map((s) => sql`${s}`),
    sql`, `,
  );
  const result = await db.execute<{ exists: boolean }>(sql`
    select exists (
      select 1 from ${game}
      where ${game.sport} in (${sportsSql})
        and ${game.startsAt} >= (${leagueRow.seasonStart}::timestamp at time zone ${leagueRow.timezone})
        and exists (select 1 from result where result.game_id = ${game.id})
    ) as "exists"
  `);
  return result.rows[0]!.exists;
}

/**
 * Leagues and membership (JAC-25-30) — see docs/leagues-and-membership.md
 * for the full design rationale (commissioner invariant, soft leave/
 * rejoin, freeze rule, ranking definition, scope boundaries). Invite
 * code/preview/join routes live in league-invites.routes.ts.
 */
export async function leaguesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "sports", "seasonStart"],
          properties: {
            name: { type: "string", minLength: 1 },
            sports: { type: "array", items: { type: "string" }, minItems: 1 },
            timezone: { type: "string", minLength: 1 },
            seasonStart: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, sports, timezone, seasonStart } = request.body as {
        name: string;
        sports: string[];
        timezone?: string;
        seasonStart: string;
      };
      const userId = request.user!.id;

      const invalidSport = sports.find((s) => !(s in ESPN_SPORT_SLUGS));
      if (invalidSport) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "sports", message: `unknown sport code: ${invalidSport}` },
        ]);
      }
      if (containsDisallowedContent(name)) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "name", message: "contains disallowed content" },
        ]);
      }
      if (timezone !== undefined && !isValidIanaTimeZone(timezone)) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "timezone", message: "must be a valid IANA time zone" },
        ]);
      }

      const [activeLeagueCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leagueMember)
        .where(and(eq(leagueMember.userId, userId), isNull(leagueMember.leftAt)));
      if (activeLeagueCountRow!.count >= env.MAX_LEAGUES_PER_USER) {
        throw new ApiError("MAX_LEAGUES_REACHED", "You've reached the maximum number of leagues", 409);
      }

      let resolvedTimezone = timezone;
      if (resolvedTimezone === undefined) {
        const [creator] = await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId)).limit(1);
        resolvedTimezone = creator!.timezone;
      }

      const { createdLeague, inviteCode } = await db.transaction(async (tx) => {
        const [createdLeague] = await tx
          .insert(league)
          .values({ name, sports, commissionerId: userId, timezone: resolvedTimezone!, seasonStart })
          .returning();
        await tx.insert(leagueMember).values({ userId, leagueId: createdLeague!.id, role: "commissioner" });
        const inviteCode = await insertInviteCodeWithRetry(tx as unknown as typeof db, createdLeague!.id);
        return { createdLeague: createdLeague!, inviteCode };
      });

      reply.status(201);
      return { ...createdLeague, memberCount: 1, inviteCode: inviteCode.code };
    },
  );

  /**
   * The multi-league home screen (JAC-29) — the daily-loop surface the
   * whole notification epic depends on. Computed in two batched queries
   * (not N+1 per league): one CTE ranking every active member of every
   * league the caller belongs to by wins, the other counting each
   * membership's still-unpicked future games. See
   * docs/leagues-and-membership.md for the full query design and why
   * wins/losses don't re-filter by current `sports` (the freeze rule
   * already makes that moot by the time anything is graded).
   */
  app.get("/", async (request) => {
    const userId = request.user!.id;

    const memberships = await db
      .select({
        leagueMemberId: leagueMember.id,
        leagueId: league.id,
        name: league.name,
        sports: league.sports,
      })
      .from(leagueMember)
      .innerJoin(league, eq(league.id, leagueMember.leagueId))
      .where(and(eq(leagueMember.userId, userId), isNull(leagueMember.leftAt)));

    if (memberships.length === 0) return [];

    // sql.join(...), not a bare `${array}` interpolation — drizzle's sql
    // tag flattens a plain JS array into an IN-list of $n placeholders,
    // not a single bound Postgres array, so `= any(${array})` would only
    // ever bind the array's first element. See isSportsSelectionFrozen's
    // comment for the same gotcha.
    const leagueIdsSql = sql.join(
      memberships.map((m) => sql`${m.leagueId}`),
      sql`, `,
    );
    const leagueMemberIdsSql = sql.join(
      memberships.map((m) => sql`${m.leagueMemberId}`),
      sql`, `,
    );

    const recordsResult = await db.execute<{
      league_member_id: string;
      wins: number;
      losses: number;
      rank: number;
      member_count: number;
    }>(sql`
      with member_records as (
        select
          lm.id as league_member_id,
          lm.league_id,
          count(*) filter (where p.selected_team = r.winning_team)::int as wins,
          count(*) filter (where r.id is not null and p.selected_team != r.winning_team)::int as losses
        from league_member lm
        left join pick p on p.league_member_id = lm.id
        left join result r on r.game_id = p.game_id
        where lm.left_at is null and lm.league_id in (${leagueIdsSql})
        group by lm.id, lm.league_id
      )
      select
        league_member_id,
        wins,
        losses,
        (rank() over (partition by league_id order by wins desc))::int as rank,
        (count(*) over (partition by league_id))::int as member_count
      from member_records
    `);

    const unpickedResult = await db.execute<{
      league_member_id: string;
      unpicked_count: number;
      next_lock_at: Date | null;
    }>(sql`
      select
        lm.id as league_member_id,
        count(g.id)::int as unpicked_count,
        min(g.starts_at) as next_lock_at
      from league_member lm
      join league l on l.id = lm.league_id
      join game g on g.sport = any(l.sports) and g.starts_at > now()
      left join pick p on p.league_member_id = lm.id and p.game_id = g.id
      where lm.id in (${leagueMemberIdsSql}) and p.id is null
      group by lm.id
    `);

    const recordsByMember = new Map(recordsResult.rows.map((r) => [r.league_member_id, r]));
    const unpickedByMember = new Map(unpickedResult.rows.map((r) => [r.league_member_id, r]));

    const results = memberships.map((m) => {
      const record = recordsByMember.get(m.leagueMemberId);
      const unpicked = unpickedByMember.get(m.leagueMemberId);
      return {
        id: m.leagueId,
        name: m.name,
        sports: m.sports,
        memberCount: record?.member_count ?? 1,
        record: { wins: record?.wins ?? 0, losses: record?.losses ?? 0 },
        gamesParticipated: (record?.wins ?? 0) + (record?.losses ?? 0),
        rank: record?.rank ?? 1,
        unpickedCount: unpicked?.unpicked_count ?? 0,
        nextLockAt: unpicked?.next_lock_at ?? null,
      };
    });

    // Urgency ordering: leagues with something open come first, soonest
    // lock within that group first; leagues with nothing open trail,
    // sorted by name for stable output.
    results.sort((a, b) => {
      if (a.unpickedCount > 0 && b.unpickedCount === 0) return -1;
      if (a.unpickedCount === 0 && b.unpickedCount > 0) return 1;
      if (a.unpickedCount > 0 && b.unpickedCount > 0) {
        return (a.nextLockAt?.getTime() ?? Infinity) - (b.nextLockAt?.getTime() ?? Infinity);
      }
      return a.name.localeCompare(b.name);
    });

    return results;
  });

  app.get(
    "/:leagueId",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      await requireLeagueMembership(request.user!.id, leagueId);

      const [leagueRow] = await db.select().from(league).where(eq(league.id, leagueId)).limit(1);
      const [memberCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leagueMember)
        .where(and(eq(leagueMember.leagueId, leagueId), isNull(leagueMember.leftAt)));

      return { ...leagueRow, memberCount: memberCountRow!.count };
    },
  );

  app.get(
    "/:leagueId/picks",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      await requireLeagueMembership(request.user!.id, leagueId);

      return db
        .select({
          leagueMemberId: leagueMember.id,
          userDisplayName: user.displayName,
          gameId: game.id,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          selectedTeam: pick.selectedTeam,
        })
        .from(pick)
        .innerJoin(leagueMember, eq(leagueMember.id, pick.leagueMemberId))
        .innerJoin(user, eq(user.id, leagueMember.userId))
        .innerJoin(game, eq(game.id, pick.gameId))
        .where(eq(leagueMember.leagueId, leagueId));
    },
  );

  app.put(
    "/:leagueId/members/:memberId/picks/:gameId",
    {
      schema: {
        params: {
          type: "object",
          required: ["leagueId", "memberId", "gameId"],
          properties: {
            leagueId: { type: "string" },
            memberId: { type: "string" },
            gameId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["selectedTeam"],
          properties: { selectedTeam: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request) => {
      const { leagueId, memberId, gameId } = request.params as {
        leagueId: string;
        memberId: string;
        gameId: string;
      };
      const { selectedTeam } = request.body as { selectedTeam: string };

      // Ownership check: memberId in the URL must be the caller's own
      // membership row for this league — a mismatch here is exactly the
      // "write only your own picks" case JAC-17 asks to be tested.
      await requireOwnMembership(request.user!.id, leagueId, memberId);

      const [leagueRow] = await db.select({ sports: league.sports }).from(league).where(eq(league.id, leagueId)).limit(1);

      const result = await writePick(db, {
        leagueMemberId: memberId,
        gameId,
        selectedTeam,
        leagueSports: leagueRow!.sports,
      });

      if (!result.accepted) {
        const field = result.reason === "INVALID_TEAM_SELECTION" ? "selectedTeam" : "gameId";
        throw rejectionToApiError(result.reason, result.message, field);
      }

      return result.pick;
    },
  );

  app.patch(
    "/:leagueId",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            sports: { type: "array", items: { type: "string" }, minItems: 1 },
          },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { name, sports } = request.body as { name?: string; sports?: string[] };

      await requireLeagueCommissioner(request.user!.id, leagueId);

      const [current] = await db.select().from(league).where(eq(league.id, leagueId)).limit(1);

      const updates: Partial<typeof league.$inferInsert> = {};

      if (name !== undefined) {
        if (containsDisallowedContent(name)) {
          throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
            { field: "name", message: "contains disallowed content" },
          ]);
        }
        updates.name = name;
      }

      if (sports !== undefined && JSON.stringify([...sports].sort()) !== JSON.stringify([...current!.sports].sort())) {
        const invalidSport = sports.find((s) => !(s in ESPN_SPORT_SLUGS));
        if (invalidSport) {
          throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
            { field: "sports", message: `unknown sport code: ${invalidSport}` },
          ]);
        }
        if (await isSportsSelectionFrozen(current!)) {
          throw new ApiError(
            "SPORTS_SELECTION_FROZEN",
            "This league already has a graded game — the sports selection can no longer be changed",
            409,
          );
        }
        updates.sports = sports;
      }

      const [updated] = await db.update(league).set(updates).where(eq(league.id, leagueId)).returning();
      return updated;
    },
  );

  app.delete(
    "/:leagueId",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request, reply) => {
      const { leagueId } = request.params as { leagueId: string };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      // Safe to hard-delete: unlike a single leaving member, once the
      // ENTIRE league is gone there's no other member's standings left
      // that depends on this history. game/result are global and
      // untouched by any of this.
      await db.transaction(async (tx) => {
        const members = await tx.select({ id: leagueMember.id }).from(leagueMember).where(eq(leagueMember.leagueId, leagueId));
        const memberIds = members.map((m) => m.id);
        if (memberIds.length > 0) {
          await tx.delete(pick).where(inArray(pick.leagueMemberId, memberIds));
        }
        await tx.delete(leagueMemberReport).where(eq(leagueMemberReport.leagueId, leagueId));
        await tx.delete(leagueInviteCode).where(eq(leagueInviteCode.leagueId, leagueId));
        await tx.delete(leagueMember).where(eq(leagueMember.leagueId, leagueId));
        await tx.delete(league).where(eq(league.id, leagueId));
      });

      reply.status(204);
    },
  );

  app.post(
    "/:leagueId/transfer-commissioner",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        body: {
          type: "object",
          required: ["newCommissionerMemberId"],
          properties: { newCommissionerMemberId: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { newCommissionerMemberId } = request.body as { newCommissionerMemberId: string };

      await requireLeagueCommissioner(request.user!.id, leagueId);

      const [target] = await db
        .select()
        .from(leagueMember)
        .where(
          and(
            eq(leagueMember.id, newCommissionerMemberId),
            eq(leagueMember.leagueId, leagueId),
            isNull(leagueMember.leftAt),
          ),
        )
        .limit(1);

      if (!target) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "newCommissionerMemberId", message: "must be an active member of this league" },
        ]);
      }

      // sync_commissioner_role (0004_leagues_membership.sql) keeps
      // league_member.role in sync with this — see
      // docs/leagues-and-membership.md.
      await db.update(league).set({ commissionerId: target.userId }).where(eq(league.id, leagueId));

      return { message: "Commissioner role transferred" };
    },
  );

  app.post(
    "/:leagueId/leave",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const userId = request.user!.id;

      const member = await requireLeagueMembership(userId, leagueId);
      const [leagueRow] = await db.select().from(league).where(eq(league.id, leagueId)).limit(1);

      if (leagueRow!.commissionerId === userId) {
        const [otherActiveMembersRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(leagueMember)
          .where(
            and(eq(leagueMember.leagueId, leagueId), isNull(leagueMember.leftAt), ne(leagueMember.userId, userId)),
          );

        if (otherActiveMembersRow!.count > 0) {
          throw new ApiError(
            "COMMISSIONER_MUST_TRANSFER_FIRST",
            "Transfer the commissioner role to another member before leaving",
            409,
          );
        }
        throw new ApiError(
          "SOLE_MEMBER_USE_DELETE",
          "You're the only member left — delete the league instead of leaving",
          409,
        );
      }

      await db.update(leagueMember).set({ leftAt: nowUtc().toJSDate() }).where(eq(leagueMember.id, member.id));
      return { message: "Left the league" };
    },
  );

  app.delete(
    "/:leagueId/members/:memberId",
    {
      schema: {
        params: {
          type: "object",
          required: ["leagueId", "memberId"],
          properties: { leagueId: { type: "string" }, memberId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { leagueId, memberId } = request.params as { leagueId: string; memberId: string };
      const commissionerMember = await requireLeagueCommissioner(request.user!.id, leagueId);

      if (memberId === commissionerMember.id) {
        throw new ApiError(
          "CANNOT_REMOVE_SELF",
          "Use leave, transfer-commissioner, or delete the league instead",
          400,
        );
      }

      const [target] = await db
        .select()
        .from(leagueMember)
        .where(and(eq(leagueMember.id, memberId), eq(leagueMember.leagueId, leagueId), isNull(leagueMember.leftAt)))
        .limit(1);

      if (!target) {
        throw new ApiError("FORBIDDEN", "Not an active member of this league", 403);
      }

      await db.update(leagueMember).set({ leftAt: nowUtc().toJSDate() }).where(eq(leagueMember.id, memberId));
      reply.status(204);
    },
  );

  app.get(
    "/:leagueId/members",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1 }, cursor: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { limit: rawLimit, cursor } = request.query as { limit?: number; cursor?: string };
      await requireLeagueMembership(request.user!.id, leagueId);

      const limit = Math.min(rawLimit ?? MEMBERS_PAGE_DEFAULT_LIMIT, MEMBERS_PAGE_MAX_LIMIT);

      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "cursor", message: "invalid cursor" },
        ]);
      }

      const rows = await db
        .select({
          id: leagueMember.id,
          userId: leagueMember.userId,
          displayName: user.displayName,
          role: leagueMember.role,
          joinedAt: leagueMember.joinedAt,
        })
        .from(leagueMember)
        .innerJoin(user, eq(user.id, leagueMember.userId))
        .where(
          and(
            eq(leagueMember.leagueId, leagueId),
            isNull(leagueMember.leftAt),
            // date_trunc('milliseconds', ...) on BOTH sides of this
            // comparison and the ORDER BY below, not just the cursor
            // value — node-postgres's timestamptz parser (a JS Date)
            // only has millisecond resolution, but the column itself is
            // stored with microsecond precision. Comparing the raw
            // column against a millisecond-truncated cursor value would
            // let the boundary row's real sub-millisecond remainder
            // satisfy `>` against its own truncated cursor and
            // re-appear on the next page. Truncating the column too
            // keeps both sides on the same precision.
            decoded
              ? sql`(date_trunc('milliseconds', ${leagueMember.joinedAt}), ${leagueMember.id}) > (${decoded.joinedAt}::timestamptz, ${decoded.id})`
              : undefined,
          ),
        )
        .orderBy(sql`date_trunc('milliseconds', ${leagueMember.joinedAt})`, leagueMember.id)
        .limit(limit + 1);

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page,
        pagination: {
          next_cursor: hasNext && last ? encodeCursor(last.joinedAt, last.id) : null,
          limit,
        },
      };
    },
  );

  app.post(
    "/:leagueId/members/:memberId/report",
    {
      schema: {
        params: {
          type: "object",
          required: ["leagueId", "memberId"],
          properties: { leagueId: { type: "string" }, memberId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["reason"],
          properties: { reason: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { leagueId, memberId } = request.params as { leagueId: string; memberId: string };
      const { reason } = request.body as { reason: string };

      const reporter = await requireLeagueMembership(request.user!.id, leagueId);

      if (memberId === reporter.id) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "memberId", message: "cannot report yourself" },
        ]);
      }

      const [target] = await db
        .select()
        .from(leagueMember)
        .where(and(eq(leagueMember.id, memberId), eq(leagueMember.leagueId, leagueId)))
        .limit(1);
      if (!target) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "memberId", message: "not a member of this league" },
        ]);
      }

      const [created] = await db
        .insert(leagueMemberReport)
        .values({ leagueId, reporterLeagueMemberId: reporter.id, reportedLeagueMemberId: memberId, reason })
        .returning();

      reply.status(201);
      return created;
    },
  );

  app.get(
    "/:leagueId/reports",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      return db.select().from(leagueMemberReport).where(eq(leagueMemberReport.leagueId, leagueId));
    },
  );
}
