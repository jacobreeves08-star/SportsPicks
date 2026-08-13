import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { league, leagueInviteCode, leagueMember } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { requireLeagueCommissioner } from "../lib/authorization.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/http-errors.js";
import { generateInviteCode, isUniqueConstraintViolation } from "../lib/invite-code.js";
import { rateLimitErrorResponseBuilder, registerAccountRateLimit } from "../lib/rate-limit.js";
import { nowUtc } from "../lib/time.js";

/**
 * Invite code lifecycle (view/rotate, commissioner-only) and the
 * join flow (preview -> confirm) for JAC-25-30. Separate file from
 * leagues.routes.ts purely for size; same `/leagues` prefix, own
 * `authenticate` hook. See docs/leagues-and-membership.md.
 */
export async function leagueInvitesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  await registerAccountRateLimit(app);

  app.get(
    "/:leagueId/invite-code",
    { schema: { params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } } } },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      const [row] = await db.select().from(leagueInviteCode).where(eq(leagueInviteCode.leagueId, leagueId)).limit(1);
      if (!row) {
        throw new ApiError("INVITE_CODE_NOT_FOUND", "This league has no invite code", 404);
      }

      return {
        code: row.code,
        deepLink: `${env.PUBLIC_API_URL}/join?code=${row.code}`,
        maxUses: row.maxUses,
        usesCount: row.usesCount,
        expiresAt: row.expiresAt,
      };
    },
  );

  app.patch(
    "/:leagueId/invite-code",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            rotate: { type: "boolean" },
            maxUses: { type: ["integer", "null"], minimum: 1 },
            expiresAt: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { rotate, maxUses, expiresAt } = request.body as {
        rotate?: boolean;
        maxUses?: number | null;
        expiresAt?: string | null;
      };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      const updates: Partial<typeof leagueInviteCode.$inferInsert> = {};
      if (maxUses !== undefined) updates.maxUses = maxUses;
      if (expiresAt !== undefined) updates.expiresAt = expiresAt === null ? null : new Date(expiresAt);

      if (rotate) {
        // Regenerating the code invalidates the old one immediately
        // (it's simply overwritten) and resets uses_count — "rotate"
        // literally, not a history table. Retried on the
        // astronomically rare collision, same as league creation.
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            updates.code = generateInviteCode();
            updates.usesCount = 0;
            const [updated] = await db
              .update(leagueInviteCode)
              .set(updates)
              .where(eq(leagueInviteCode.leagueId, leagueId))
              .returning();
            return updated;
          } catch (err) {
            if (attempt === 5 || !isUniqueConstraintViolation(err)) throw err;
          }
        }
      }

      const [updated] = await db
        .update(leagueInviteCode)
        .set(updates)
        .where(eq(leagueInviteCode.leagueId, leagueId))
        .returning();
      return updated;
    },
  );

  /**
   * `/preview` and `/join` are "guess an invite code" endpoints — a
   * tight, PER-USER limit here specifically slows code-guessing, on top
   * of (not instead of) the app-wide per-IP limit (app.ts) and the
   * general per-account limit registered above. Nested plugin
   * registration, not a route-level `config.rateLimit` override: that
   * field is read by EVERY listening `@fastify/rate-limit` registration's
   * own `onRoute` hook, so two independent registrations can't each
   * express a different config through the same shared field — confirmed
   * empirically while fixing what used to be here (`config.rateLimit:
   * {max:20}` plus an explicit `preHandler: app.rateLimit({max:10,
   * keyGenerator: perUser})`), which looked like two layered limits but
   * was actually one working per-IP check and one COMPLETELY INERT
   * per-user check — every rate-limit check derived from the same
   * `@fastify/rate-limit` registration shares one single-fire-per-request
   * guard (see lib/rate-limit.ts's comment for the full mechanism), so
   * the second check never even evaluated, let alone rejected anything.
   * A genuinely independent check needs its own registration, which is
   * what this nested nested plugin provides — no `config.rateLimit` set
   * on these routes at all, so it applies via its own default to every
   * route declared in this scope, same as the per-account registration
   * above applies to the rest of this file.
   */
  await app.register(async (instance) => {
    await instance.register(rateLimit, {
      max: 10,
      timeWindow: "1 minute",
      hook: "preHandler",
      keyGenerator: (req) => req.user!.id,
      errorResponseBuilder: rateLimitErrorResponseBuilder,
    });

    instance.get(
      "/preview",
      { schema: { querystring: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } },
      async (request) => {
        const { code } = request.query as { code: string };
        const userId = request.user!.id;

        const [codeRow] = await db.select().from(leagueInviteCode).where(eq(leagueInviteCode.code, code)).limit(1);
        if (!codeRow) {
          throw new ApiError("INVITE_CODE_NOT_FOUND", "Invalid invite code", 404);
        }
        if (codeRow.expiresAt && codeRow.expiresAt <= nowUtc().toJSDate()) {
          throw new ApiError("INVITE_CODE_EXPIRED", "This invite code has expired", 410);
        }
        if (codeRow.maxUses !== null && codeRow.usesCount >= codeRow.maxUses) {
          throw new ApiError("INVITE_CODE_MAX_USES_REACHED", "This invite code has reached its use limit", 409);
        }

        const [leagueRow] = await db.select().from(league).where(eq(league.id, codeRow.leagueId)).limit(1);
        const [memberCountRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(leagueMember)
          .where(and(eq(leagueMember.leagueId, codeRow.leagueId), isNull(leagueMember.leftAt)));
        const [existingMember] = await db
          .select()
          .from(leagueMember)
          .where(
            and(
              eq(leagueMember.userId, userId),
              eq(leagueMember.leagueId, codeRow.leagueId),
              isNull(leagueMember.leftAt),
            ),
          )
          .limit(1);

        return {
          name: leagueRow!.name,
          sports: leagueRow!.sports,
          memberCount: memberCountRow!.count,
          alreadyMember: existingMember !== undefined,
        };
      },
    );

    instance.post(
      "/join",
      {
        schema: {
          body: { type: "object", required: ["code"], properties: { code: { type: "string" } } },
        },
      },
      async (request) => {
        const { code } = request.body as { code: string };
        const userId = request.user!.id;

        // Single atomic statement, not read-then-write: the UPDATE's row
        // lock on this league's one invite-code row is what serializes
        // concurrent redeemers (Postgres re-checks the WHERE clause,
        // including the max-members subquery, against the just-committed
        // row for whoever was blocked) — see docs/leagues-and-membership.md
        // for the full reasoning. ON CONFLICT reactivates a prior
        // left_at-marked row rather than inserting a new one, which is
        // what makes "rejoining restores prior picks" true for free.
        const joined = await db.execute<{ id: string; league_id: string }>(sql`
          with incr as (
            update league_invite_code
              set uses_count = uses_count + 1
              where code = ${code}
                and (expires_at is null or expires_at > now())
                and (max_uses is null or uses_count < max_uses)
                and (
                  select count(*) from league_member
                  where league_id = league_invite_code.league_id and left_at is null
                ) < ${env.MAX_LEAGUE_MEMBERS}
              returning league_id
          )
          insert into league_member (user_id, league_id, role)
          select ${userId}, league_id, 'member' from incr
          on conflict (user_id, league_id) do update set left_at = null
          returning id, league_id
        `);

        if (joined.rows.length > 0) {
          const [leagueRow] = await db.select().from(league).where(eq(league.id, joined.rows[0]!.league_id)).limit(1);
          return { leagueId: joined.rows[0]!.league_id, leagueName: leagueRow!.name };
        }

        // The atomic attempt above didn't produce a row — figure out why,
        // on this failure path only (the common success path never pays
        // for this extra lookup).
        const [codeRow] = await db.select().from(leagueInviteCode).where(eq(leagueInviteCode.code, code)).limit(1);
        if (!codeRow) {
          throw new ApiError("INVITE_CODE_NOT_FOUND", "Invalid invite code", 404);
        }
        if (codeRow.expiresAt && codeRow.expiresAt <= nowUtc().toJSDate()) {
          throw new ApiError("INVITE_CODE_EXPIRED", "This invite code has expired", 410);
        }
        if (codeRow.maxUses !== null && codeRow.usesCount >= codeRow.maxUses) {
          throw new ApiError("INVITE_CODE_MAX_USES_REACHED", "This invite code has reached its use limit", 409);
        }
        // Only remaining explanation (barring an extremely narrow race
        // where state changed between the attempt and this diagnostic
        // read, in which case a retry by the client resolves it).
        throw new ApiError("LEAGUE_FULL", "This league is at capacity", 409);
      },
    );
  });
}
