import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  game,
  golfPick,
  golfPickSelection,
  league,
  leagueMember,
  leagueMemberReport,
  leagueInviteCode,
  pick,
  pickAuditLog,
  tournament,
  tournamentEntry,
  user,
} from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { logEvent } from "../lib/analytics.js";
import { containsDisallowedContent } from "../lib/content-filter.js";
import { captureException } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { rejectionToApiError as golfRejectionToApiError, writeGolfPick } from "../lib/golf-pick-write.js";
import { ApiError } from "../lib/http-errors.js";
import { logger } from "../lib/logger.js";
import { generateInviteCode, isUniqueConstraintViolation } from "../lib/invite-code.js";
import { rateLimitErrorResponseBuilder, registerAccountRateLimit } from "../lib/rate-limit.js";
import { requireLeagueCommissioner, requireLeagueMembership, requireOwnMembership } from "../lib/authorization.js";
import { rejectionToApiError, writePick } from "../lib/pick-write.js";
import { getCachedSlate, setCachedSlate } from "../lib/slate-cache.js";
import { ESPN_SPORT_SLUGS } from "../lib/sports-provider.js";
import { dayBoundsUtc, isValidIanaTimeZone, nowUtc } from "../lib/time.js";
import { DateTime } from "luxon";

// "golf" is deliberately NOT in ESPN_SPORT_SLUGS (see sports-provider.ts —
// it doesn't fit the game/pick adapter shape at all), but it's still a
// real sport a league can opt into via this same `sports` array, using
// its own tournament/golf_pick tables instead of game/pick. Every query
// that joins `sports` against the `game` table (unpickedCount, the home
// screen) is naturally a no-op for "golf" since no game row ever has
// that sport, so no other change was needed to let it coexist here.
function isValidSportCode(sport: string): boolean {
  return sport in ESPN_SPORT_SLUGS || sport === "golf";
}

interface SlateResponse {
  date: string;
  games: Array<{
    gameId: string;
    sport: string;
    homeTeam: string;
    awayTeam: string;
    startsAt: Date;
    status: string;
    allowsDraw: boolean;
    winningTeam: string | null;
    locked: boolean;
    myPick: string | null;
    otherPicks: Array<{ leagueMemberId: string; displayName: string; hasPicked: boolean; selectedTeam: string | null }>;
    pickState: string;
  }>;
  pickedCount: number;
  totalCount: number;
}

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

const AUDIT_LOG_PAGE_DEFAULT_LIMIT = 25;
const AUDIT_LOG_PAGE_MAX_LIMIT = 100;

// Same cursor shape/pattern as encodeCursor/decodeCursor above, over
// createdAt instead of joinedAt — kept as a separate small pair rather
// than generalizing the existing one, so this doesn't risk touching
// already-verified members-pagination behavior for a two-call-site
// abstraction.
function encodeAuditLogCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function decodeAuditLogCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
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
  await registerAccountRateLimit(app);

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
            pickHorizonDays: { type: "integer", minimum: 1, maximum: 30 },
            golfPickCount: { type: "integer", minimum: 1, maximum: 10 },
            golfTopN: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, sports, timezone, seasonStart, pickHorizonDays, golfPickCount, golfTopN } = request.body as {
        name: string;
        sports: string[];
        timezone?: string;
        seasonStart: string;
        pickHorizonDays?: number;
        golfPickCount?: number;
        golfTopN?: number;
      };
      const userId = request.user!.id;

      const invalidSport = sports.find((s) => !isValidSportCode(s));
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
          .values({
            name,
            sports,
            commissionerId: userId,
            timezone: resolvedTimezone!,
            seasonStart,
            ...(pickHorizonDays !== undefined && { pickHorizonDays }),
            ...(golfPickCount !== undefined && { golfPickCount }),
            ...(golfTopN !== undefined && { golfTopN }),
          })
          .returning();
        await tx.insert(leagueMember).values({ userId, leagueId: createdLeague!.id, role: "commissioner" });
        const inviteCode = await insertInviteCodeWithRetry(tx as unknown as typeof db, createdLeague!.id);
        return { createdLeague: createdLeague!, inviteCode };
      });

      await logEvent("league_created", { userId, leagueId: createdLeague!.id });

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
   *
   * Wins/losses read `pick.outcome` directly (JAC-37-42) rather than
   * live-joining `result` and comparing `selected_team` — this genuinely
   * is a frequently-read standings view, so "graded once, read many
   * times" applies here too, not just to the authoritative standings
   * endpoint in standings.routes.ts. This `rank` stays the simpler
   * win-desc `RANK()` with ties allowed, a deliberate, different, and
   * already-documented design for a quick-glance view — not replaced by
   * the full tiebreaker chain, which lives only in the standings
   * endpoint.
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
          count(*) filter (where p.outcome = 'win')::int as wins,
          count(*) filter (where p.outcome = 'loss')::int as losses
        from league_member lm
        left join pick p on p.league_member_id = lm.id
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

    // NOTE: db.execute()'s raw path returns timestamptz columns as
    // Postgres's text representation, not a JS Date (confirmed
    // empirically — see docs/scoring-and-standings.md's engineering
    // note) — next_lock_at is converted below. This was a live bug: the
    // sort below calls `.getTime()` on it, which throws when two
    // leagues both have unpicked games, since a string has no such
    // method.
    const unpickedResult = await db.execute<{
      league_member_id: string;
      unpicked_count: number;
      next_lock_at: string | null;
    }>(sql`
      select
        lm.id as league_member_id,
        count(g.id)::int as unpicked_count,
        min(g.starts_at) as next_lock_at
      from league_member lm
      join league l on l.id = lm.league_id
      join game g on g.sport = any(l.sports)
        and g.starts_at > now()
        and g.starts_at < now() + (l.pick_horizon_days * interval '1 day')
      left join pick p on p.league_member_id = lm.id and p.game_id = g.id
      where lm.id in (${leagueMemberIdsSql}) and p.id is null
      group by lm.id
    `);

    const recordsByMember = new Map(recordsResult.rows.map((r) => [r.league_member_id, r]));
    const unpickedByMember = new Map(
      unpickedResult.rows.map((r) => [
        r.league_member_id,
        { ...r, next_lock_at: r.next_lock_at === null ? null : new Date(r.next_lock_at) },
      ]),
    );

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
        // Epic 10: the caller's own membership id for this league —
        // already computed above for the internal joins, just never
        // returned before. No privacy concern (it's the caller's own
        // id, on the caller's own "my leagues" list) — needed so a
        // client can address `PATCH /:leagueId/members/:memberId/...`
        // routes (picks, notifications) without a second round trip.
        leagueMemberId: m.leagueMemberId,
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

  /**
   * Pick-write rate limiting (JAC-43-48) — per member, not just the
   * general account-wide limit registered above: a dedicated, tighter
   * ceiling on the two routes that actually mutate picks, so a buggy or
   * abusive client hammering writes specifically is caught faster than
   * the broader 300/min covers every route in this file. A fresh,
   * independent registration (not a route-level `config.rateLimit` or a
   * second `app.rateLimit()` off the account registration above) — see
   * lib/rate-limit.ts's comment for why that's required for the check to
   * actually run, not just look configured. Keyed by `request.user.id`,
   * same as the account-wide limit — `requireOwnMembership` below already
   * guarantees `memberId` in the URL is the caller's own, so keying by
   * either is equivalent for accepted requests, and the user id is
   * available before that check even runs.
   */
  await app.register(async (instance) => {
    await instance.register(rateLimit, {
      max: env.PICK_WRITE_RATE_LIMIT_PER_MINUTE,
      timeWindow: "1 minute",
      hook: "preHandler",
      keyGenerator: (req) => req.user!.id,
      errorResponseBuilder: rateLimitErrorResponseBuilder,
    });

    instance.put(
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

        const [leagueRow] = await db
          .select({ sports: league.sports, pickHorizonDays: league.pickHorizonDays })
          .from(league)
          .where(eq(league.id, leagueId))
          .limit(1);

        const result = await writePick(db, {
          leagueId,
          leagueMemberId: memberId,
          gameId,
          selectedTeam,
          leagueSports: leagueRow!.sports,
          pickHorizonDays: leagueRow!.pickHorizonDays,
        });

        if (!result.accepted) {
          const field = result.reason === "INVALID_TEAM_SELECTION" ? "selectedTeam" : "gameId";
          throw rejectionToApiError(result.reason, result.message, field);
        }

        return result.pick;
      },
    );

    /**
     * Batch write a full slate at once (JAC-31-36). Per-game, not
     * all-or-nothing: one outer transaction so accepted writes become
     * visible together, but each game's writePick() call runs inside its
     * OWN nested transaction (a real Postgres SAVEPOINT via Drizzle's
     * nested db.transaction() support — verified against real Postgres
     * in Epic 5 step 1) so an unanticipated failure on one game can never
     * poison the others. writePick() itself doesn't throw for an
     * ordinary rejection (locked/canceled/etc — that's a normal return
     * value), so the savepoint is a defensive backstop, not the primary
     * mechanism; it exists specifically so a bug or a genuine DB-level
     * exception on game N doesn't roll back games 1..N-1's already-
     * accepted picks. See docs/picks-and-locking.md.
     */
    instance.post(
      "/:leagueId/members/:memberId/picks/batch",
      {
        schema: {
          params: {
            type: "object",
            required: ["leagueId", "memberId"],
            properties: { leagueId: { type: "string" }, memberId: { type: "string" } },
          },
          body: {
            type: "object",
            required: ["picks"],
            properties: {
              picks: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                  type: "object",
                  required: ["gameId", "selectedTeam"],
                  properties: { gameId: { type: "string" }, selectedTeam: { type: "string", minLength: 1 } },
                },
              },
            },
          },
        },
      },
      async (request) => {
        const { leagueId, memberId } = request.params as { leagueId: string; memberId: string };
        const { picks } = request.body as { picks: Array<{ gameId: string; selectedTeam: string }> };

        await requireOwnMembership(request.user!.id, leagueId, memberId);

        const [leagueRow] = await db
          .select({ sports: league.sports, pickHorizonDays: league.pickHorizonDays })
          .from(league)
          .where(eq(league.id, leagueId))
          .limit(1);

        const results = await db.transaction(async (tx) => {
          const perGame: Array<{
            gameId: string;
            status: "accepted" | "rejected";
            pick?: { selectedTeam: string };
            error?: { code: string; message: string };
          }> = [];

          for (const { gameId, selectedTeam } of picks) {
            try {
              const result = await (tx as unknown as typeof db).transaction(async (nestedTx) =>
                writePick(nestedTx as unknown as typeof db, {
                  leagueId,
                  leagueMemberId: memberId,
                  gameId,
                  selectedTeam,
                  leagueSports: leagueRow!.sports,
                  pickHorizonDays: leagueRow!.pickHorizonDays,
                }),
              );

              if (result.accepted) {
                perGame.push({ gameId, status: "accepted", pick: { selectedTeam: result.pick.selectedTeam } });
              } else {
                const field = result.reason === "INVALID_TEAM_SELECTION" ? "selectedTeam" : "gameId";
                const apiError = rejectionToApiError(result.reason, result.message, field);
                perGame.push({
                  gameId,
                  status: "rejected",
                  error: { code: apiError.code, message: apiError.message },
                });
              }
            } catch (err) {
              // Unanticipated failure for this ONE game — the nested
              // transaction's savepoint already rolled back just this
              // game's attempt. Report it and keep going; never let one
              // game's surprise poison the rest of the batch.
              logger.error({ leagueId, memberId, gameId, err }, "batch pick write failed unexpectedly for one game");
              captureException(err);
              perGame.push({
                gameId,
                status: "rejected",
                error: { code: "INTERNAL_ERROR", message: "Unexpected error" },
              });
            }
          }

          return perGame;
        });

        return { results };
      },
    );

    /**
     * Golf's write endpoint (JAC-56) — same rate-limit registration as
     * the game pick routes above (one member hammering writes is one
     * member hammering writes, regardless of sport). Unlike a game
     * pick, this is a full replace of the member's golfer selections
     * for the tournament, not a single scalar — see
     * lib/golf-pick-write.ts's own doc comment for why that's safe.
     */
    instance.put(
      "/:leagueId/members/:memberId/golf-pick/:tournamentId",
      {
        schema: {
          params: {
            type: "object",
            required: ["leagueId", "memberId", "tournamentId"],
            properties: {
              leagueId: { type: "string" },
              memberId: { type: "string" },
              tournamentId: { type: "string" },
            },
          },
          body: {
            type: "object",
            required: ["golferExternalIds"],
            properties: {
              golferExternalIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
            },
          },
        },
      },
      async (request) => {
        const { leagueId, memberId, tournamentId } = request.params as {
          leagueId: string;
          memberId: string;
          tournamentId: string;
        };
        const { golferExternalIds } = request.body as { golferExternalIds: string[] };

        await requireOwnMembership(request.user!.id, leagueId, memberId);

        const [leagueRow] = await db
          .select({ sports: league.sports, golfPickCount: league.golfPickCount })
          .from(league)
          .where(eq(league.id, leagueId))
          .limit(1);

        const result = await writeGolfPick(db, {
          leagueId,
          leagueMemberId: memberId,
          tournamentId,
          golferExternalIds,
          leagueSports: leagueRow!.sports,
          golfPickCount: leagueRow!.golfPickCount,
        });

        if (!result.accepted) {
          const field = result.reason === "TOURNAMENT_NOT_FOUND" ? "tournamentId" : "golferExternalIds";
          throw golfRejectionToApiError(result.reason, result.message, field);
        }

        return result.pick;
      },
    );
  });

  /**
   * The slate for one calendar day, computed in the LEAGUE's timezone
   * (JAC-31) — day boundaries via dayBoundsUtc, never UTC and never the
   * viewer's device. One query for the whole day (no N+1 per game).
   *
   * Privacy (JAC-35), enforced entirely in the query itself, never by
   * fetching everyone's picks and filtering in application code (which
   * would leak through the network tab): `hasPicked` is always visible
   * for every other member, but `selectedTeam` for anyone other than
   * the caller is only populated by the SQL itself once `locked` is
   * true. The caller's own selection (`myPick`) is always visible
   * regardless of lock state — it's their own data.
   *
   * `locked` is computed in SQL (`now() >= starts_at`), never in the
   * app and never from a client-supplied value, with the SAME boundary
   * the write-path enforces (writePick's gate is `starts_at > now()` to
   * accept) — display and enforcement can never disagree at the
   * margin. This is a READ; the actual accept/reject decision always
   * happens again, independently, at write time — this endpoint never
   * substitutes for that.
   */
  /**
   * Slate reads get their own dedicated rate limit (JAC-43-48), tighter
   * than the general account-wide one, on top of the cache below —
   * "cap the client polling interval AND cache reads," not either
   * alone. Same independent-registration requirement as every other
   * nested plugin in this file — see lib/rate-limit.ts.
   */
  await app.register(async (instance) => {
    await instance.register(rateLimit, {
      max: env.SLATE_POLL_RATE_LIMIT_PER_MINUTE,
      timeWindow: "1 minute",
      hook: "preHandler",
      keyGenerator: (req) => req.user!.id,
      errorResponseBuilder: rateLimitErrorResponseBuilder,
    });

    instance.get(
      "/:leagueId/slate",
      {
        schema: {
          params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
          querystring: { type: "object", properties: { date: { type: "string", format: "date" } } },
        },
      },
      async (request) => {
        const { leagueId } = request.params as { leagueId: string };
        const { date } = request.query as { date?: string };
        const member = await requireLeagueMembership(request.user!.id, leagueId);

        const [leagueRow] = await db
          .select({ sports: league.sports, timezone: league.timezone })
          .from(league)
          .where(eq(league.id, leagueId))
          .limit(1);

        const resolvedDate = date ?? DateTime.now().setZone(leagueRow!.timezone).toISODate()!;

        // Cached response is fully redacted for THIS viewer already —
        // membership is still verified above on every request, cache
        // hit or not, so a stale cached response can never outlive the
        // caller's actual membership. See lib/slate-cache.ts.
        const cached = getCachedSlate<SlateResponse>(leagueId, resolvedDate, member.id);
        if (cached) return cached;

        const { start, end } = dayBoundsUtc(resolvedDate, leagueRow!.timezone);

        const sportsSql = sql.join(
          leagueRow!.sports.map((s) => sql`${s}`),
          sql`, `,
        );

        // NOTE: db.execute()'s raw path returns timestamptz columns as
        // Postgres's text representation, not a JS Date — starts_at is
        // converted below before it goes into the response, so the wire
        // format stays ISO-8601 per docs/api-conventions.md's Timestamps
        // convention. See docs/scoring-and-standings.md's engineering note.
        const slateResult = await db.execute<{
          game_id: string;
          sport: string;
          home_team: string;
          away_team: string;
          starts_at: string;
          status: string;
          allows_draw: boolean;
          winning_team: string | null;
          locked: boolean;
          my_pick: string | null;
          other_picks: Array<{
            leagueMemberId: string;
            displayName: string;
            hasPicked: boolean;
            selectedTeam: string | null;
          }>;
        }>(sql`
          select
            g.id as game_id, g.sport, g.home_team, g.away_team, g.starts_at, g.status, g.allows_draw,
            r.winning_team,
            (now() >= g.starts_at) as locked,
            max(case when lm.id = ${member.id} then p.selected_team end) as my_pick,
            coalesce(
              json_agg(json_build_object(
                'leagueMemberId', lm.id,
                'displayName', u.display_name,
                'hasPicked', (p.id is not null),
                'selectedTeam', case when now() >= g.starts_at and p.id is not null then p.selected_team else null end
              )) filter (where lm.id != ${member.id}),
              '[]'
            ) as other_picks
          from game g
          left join result r on r.game_id = g.id
          cross join league_member lm
          join "user" u on u.id = lm.user_id
          left join pick p on p.game_id = g.id and p.league_member_id = lm.id
          where g.sport in (${sportsSql})
            and g.starts_at >= ${start} and g.starts_at < ${end}
            and lm.league_id = ${leagueId} and lm.left_at is null
          group by g.id, g.sport, g.home_team, g.away_team, g.starts_at, g.status, g.allows_draw, r.winning_team
          order by g.starts_at
        `);

        const games = slateResult.rows.map((row) => {
          const pickState =
            row.winning_team !== null
              ? row.my_pick !== null && row.my_pick === row.winning_team
                ? "final_hit"
                : "final_miss"
              : row.locked
                ? "locked"
                : row.my_pick !== null
                  ? "picked_open"
                  : "unpicked";

          return {
            gameId: row.game_id,
            sport: row.sport,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            startsAt: new Date(row.starts_at),
            status: row.status,
            allowsDraw: row.allows_draw,
            winningTeam: row.winning_team,
            locked: row.locked,
            myPick: row.my_pick,
            otherPicks: row.other_picks,
            pickState,
          };
        });

        const response: SlateResponse = {
          date: resolvedDate,
          games,
          pickedCount: games.filter((g) => g.myPick !== null).length,
          totalCount: games.length,
        };
        setCachedSlate(leagueId, resolvedDate, member.id, response);
        return response;
      },
    );
  });

  /**
   * Golf's read endpoint (JAC-56) — "the one tournament to show right
   * now," not a date-scoped list like the slate: golf has at most one
   * relevant PGA event in flight at a time (see lib/golf-provider.ts),
   * so there's no per-day windowing concept to replicate here. Prefers
   * an in-progress/upcoming tournament; falls back to the most
   * recently concluded one so results stay visible after it ends.
   *
   * Same privacy shape as the slate: every other member's hasPicked is
   * always visible, but their actual golferExternalIds are only
   * revealed once the tournament has locked (started) — never before.
   * Not rate-limited beyond the general account-wide limit (unlike
   * slate reads) — this is a single-row-ish query, not something a
   * client polls on the same cadence as a live scoreboard.
   */
  app.get(
    "/:leagueId/golf/current",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const member = await requireLeagueMembership(request.user!.id, leagueId);

      const [leagueRow] = await db
        .select({ golfPickCount: league.golfPickCount, golfTopN: league.golfTopN })
        .from(league)
        .where(eq(league.id, leagueId))
        .limit(1);

      const [upcoming] = await db
        .select()
        .from(tournament)
        .where(inArray(tournament.status, ["scheduled", "in_progress"]))
        .orderBy(tournament.startsAt)
        .limit(1);
      const tournamentRow =
        upcoming ??
        (await db.select().from(tournament).orderBy(sql`${tournament.endsAt} desc`).limit(1))[0];

      if (!tournamentRow) {
        return {
          tournament: null,
          leaderboard: [],
          myPick: null,
          otherPicks: [],
          golfPickCount: leagueRow!.golfPickCount,
          golfTopN: leagueRow!.golfTopN,
        };
      }

      const locked = nowUtc().toJSDate() >= tournamentRow.startsAt;

      const entries = await db
        .select({ externalId: tournamentEntry.externalId, golferName: tournamentEntry.golferName, position: tournamentEntry.position })
        .from(tournamentEntry)
        .where(eq(tournamentEntry.tournamentId, tournamentRow.id))
        .orderBy(sql`${tournamentEntry.position} is null, ${tournamentEntry.position} asc`);

      // NOTE: db.execute()'s raw path returns json_agg results already
      // parsed (not a Postgres text representation, unlike timestamptz —
      // confirmed against the slate endpoint's own equivalent query),
      // so golfer_external_ids needs no conversion here.
      const otherPicksResult = await db.execute<{
        league_member_id: string;
        display_name: string;
        has_picked: boolean;
        golfer_external_ids: string[] | null;
      }>(sql`
        select
          lm.id as league_member_id,
          u.display_name,
          (gp.id is not null) as has_picked,
          case when ${locked} and gp.id is not null then
            coalesce(
              (select json_agg(te.external_id) from golf_pick_selection gps
                join tournament_entry te on te.id = gps.tournament_entry_id
                where gps.golf_pick_id = gp.id),
              '[]'
            )
          else null end as golfer_external_ids
        from league_member lm
        join "user" u on u.id = lm.user_id
        left join golf_pick gp on gp.league_member_id = lm.id and gp.tournament_id = ${tournamentRow.id}
        where lm.league_id = ${leagueId} and lm.left_at is null and lm.id != ${member.id}
      `);

      const [myGolfPick] = await db
        .select({ id: golfPick.id })
        .from(golfPick)
        .where(and(eq(golfPick.leagueMemberId, member.id), eq(golfPick.tournamentId, tournamentRow.id)))
        .limit(1);

      let myPick: string[] | null = null;
      if (myGolfPick) {
        const mySelections = await db
          .select({ externalId: tournamentEntry.externalId })
          .from(golfPickSelection)
          .innerJoin(tournamentEntry, eq(tournamentEntry.id, golfPickSelection.tournamentEntryId))
          .where(eq(golfPickSelection.golfPickId, myGolfPick.id));
        myPick = mySelections.map((s) => s.externalId);
      }

      return {
        tournament: {
          id: tournamentRow.id,
          name: tournamentRow.name,
          startsAt: tournamentRow.startsAt,
          endsAt: tournamentRow.endsAt,
          status: tournamentRow.status,
          locked,
        },
        leaderboard: entries,
        myPick,
        otherPicks: otherPicksResult.rows.map((r) => ({
          leagueMemberId: r.league_member_id,
          displayName: r.display_name,
          hasPicked: r.has_picked,
          golferExternalIds: r.golfer_external_ids,
        })),
        golfPickCount: leagueRow!.golfPickCount,
        golfTopN: leagueRow!.golfTopN,
      };
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
            pickHorizonDays: { type: "integer", minimum: 1, maximum: 30 },
            golfPickCount: { type: "integer", minimum: 1, maximum: 10 },
            golfTopN: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { name, sports, pickHorizonDays, golfPickCount, golfTopN } = request.body as {
        name?: string;
        sports?: string[];
        pickHorizonDays?: number;
        golfPickCount?: number;
        golfTopN?: number;
      };

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
        const invalidSport = sports.find((s) => !isValidSportCode(s));
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

      if (pickHorizonDays !== undefined) {
        updates.pickHorizonDays = pickHorizonDays;
      }
      if (golfPickCount !== undefined) {
        updates.golfPickCount = golfPickCount;
      }
      if (golfTopN !== undefined) {
        updates.golfTopN = golfTopN;
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

  /**
   * The per-league notification preference (JAC-43-48's
   * `league_member.notifications_enabled`, read by pick-reminder.ts/
   * results-summary.ts, never exposed to a client until now — see
   * docs/notifications.md). `user.notifications_enabled` (`/me/notifications`
   * above) is checked first server-side and short-circuits regardless
   * of this — this switch only matters once the global one is on.
   *
   * WRITE-ONLY as of Epic 10 — deliberately no matching read endpoint
   * yet. `GET /leagues/:leagueId/members` (below) is the obvious place
   * to have added one, but it's a list of every member in the league;
   * putting a preference this personal on it would leak one member's
   * notification setting to every other member, which is a real
   * privacy regression, not a minor omission. A correctly-scoped read
   * (a caller-scoped "my own membership" route) is real, deliberate
   * follow-up work, flagged here rather than built under time
   * pressure — see docs/app-shell.md for how the client handles this
   * gap in the meantime (defaults the toggle to the schema default
   * rather than guessing).
   */
  app.patch(
    "/:leagueId/members/:memberId/notifications",
    {
      schema: {
        params: {
          type: "object",
          required: ["leagueId", "memberId"],
          properties: { leagueId: { type: "string" }, memberId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["enabled"],
          properties: { enabled: { type: "boolean" } },
        },
      },
    },
    async (request) => {
      const { leagueId, memberId } = request.params as { leagueId: string; memberId: string };
      const { enabled } = request.body as { enabled: boolean };

      // Same ownership discipline as the pick-write route above — a
      // member may only flip their OWN notification preference.
      await requireOwnMembership(request.user!.id, leagueId, memberId);

      await db.update(leagueMember).set({ notificationsEnabled: enabled }).where(eq(leagueMember.id, memberId));

      return { notificationsEnabled: enabled };
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

  /**
   * The append-only audit trail (JAC-36), commissioner-only, cursor-
   * paginated per the established convention. This is a pure read —
   * pick_audit_log is never mutated or deleted by any application code
   * path, backstopped at the DB level by triggers that unconditionally
   * reject UPDATE/DELETE (0005_picks.sql). Optional gameId/memberId
   * filters narrow "who picked what for this specific game" or "this
   * member's full pick history," the two shapes a "I definitely picked
   * them" dispute actually needs.
   */
  app.get(
    "/:leagueId/audit-log",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1 },
            cursor: { type: "string" },
            gameId: { type: "string" },
            memberId: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { limit: rawLimit, cursor, gameId, memberId } = request.query as {
        limit?: number;
        cursor?: string;
        gameId?: string;
        memberId?: string;
      };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      const limit = Math.min(rawLimit ?? AUDIT_LOG_PAGE_DEFAULT_LIMIT, AUDIT_LOG_PAGE_MAX_LIMIT);

      const decoded = cursor ? decodeAuditLogCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "cursor", message: "invalid cursor" },
        ]);
      }

      const rows = await db
        .select({
          id: pickAuditLog.id,
          leagueMemberId: pickAuditLog.leagueMemberId,
          displayName: user.displayName,
          gameId: pickAuditLog.gameId,
          selectedTeam: pickAuditLog.selectedTeam,
          action: pickAuditLog.action,
          createdAt: pickAuditLog.createdAt,
        })
        .from(pickAuditLog)
        .innerJoin(leagueMember, eq(leagueMember.id, pickAuditLog.leagueMemberId))
        .innerJoin(user, eq(user.id, leagueMember.userId))
        .where(
          and(
            eq(leagueMember.leagueId, leagueId),
            gameId ? eq(pickAuditLog.gameId, gameId) : undefined,
            memberId ? eq(pickAuditLog.leagueMemberId, memberId) : undefined,
            // Same date_trunc('milliseconds', ...) precision fix as the
            // members-list cursor — see its comment for why comparing
            // the raw column against a millisecond-truncated cursor
            // value would let a boundary row reappear on the next page.
            decoded
              ? sql`(date_trunc('milliseconds', ${pickAuditLog.createdAt}), ${pickAuditLog.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id})`
              : undefined,
          ),
        )
        .orderBy(sql`date_trunc('milliseconds', ${pickAuditLog.createdAt})`, pickAuditLog.id)
        .limit(limit + 1);

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page,
        pagination: {
          next_cursor: hasNext && last ? encodeAuditLogCursor(last.createdAt, last.id) : null,
          limit,
        },
      };
    },
  );
}
