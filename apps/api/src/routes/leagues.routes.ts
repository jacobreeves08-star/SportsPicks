import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, league, leagueMember, pick, user } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { requireLeagueCommissioner, requireLeagueMembership, requireOwnMembership } from "../lib/authorization.js";

/**
 * Three deliberately minimal routes (JAC-17) — their only purpose is to
 * give the authorization layer something real to send HTTP requests at
 * in leagues.routes.test.ts. No standings, no lock-time gating, no
 * league/pick CRUD beyond what's needed to exercise membership,
 * ownership, and commissioner-role checks end to end. See
 * docs/adr/0002-auth-session-hashing-email.md decision 12.
 */
export async function leaguesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

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

      const [upserted] = await db
        .insert(pick)
        .values({ leagueMemberId: memberId, gameId, selectedTeam })
        .onConflictDoUpdate({ target: [pick.leagueMemberId, pick.gameId], set: { selectedTeam } })
        .returning();

      return upserted;
    },
  );

  app.patch(
    "/:leagueId",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { name } = request.body as { name: string };

      // Commissioner-only action.
      await requireLeagueCommissioner(request.user!.id, leagueId);

      const [updated] = await db.update(league).set({ name }).where(eq(league.id, leagueId)).returning();
      return updated;
    },
  );
}
