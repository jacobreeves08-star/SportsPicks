import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, league, pick, result, resultCorrection } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";
import { requireLeagueCommissioner, requireLeagueMembership } from "../lib/authorization.js";
import { ApiError } from "../lib/http-errors.js";
import { regradeGame } from "../lib/grading.js";
import { computeStandings, type Timeframe } from "../lib/standings.js";
import { dayBoundsUtc } from "../lib/time.js";

const CORRECTIONS_PAGE_DEFAULT_LIMIT = 25;
const CORRECTIONS_PAGE_MAX_LIMIT = 100;

function encodeCorrectionsCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function decodeCorrectionsCursor(cursor: string): { createdAt: string; id: string } | null {
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

/**
 * Standings, head-to-head, and result correction (JAC-37-42). Separate
 * file from leagues.routes.ts purely for size, same `/leagues` prefix,
 * own `authenticate` hook — matching the established precedent in
 * league-invites.routes.ts. See docs/scoring-and-standings.md.
 */
export async function standingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /**
   * Ranked standings for one timeframe (today/week/season, confirmed
   * fixed-Tuesday-Monday-week and full-tiebreaker-chain with the user —
   * see lib/standings.ts). `rankChange` diffs against the immediately
   * prior period of the same length (yesterday for today, the previous
   * Tuesday-Monday week for week) — not meaningful for season, always
   * null there. `callerLeagueMemberId` lets the client pin the caller's
   * own row without a second lookup (JAC-41's "current user's row
   * anchored").
   */
  app.get(
    "/:leagueId/standings",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        querystring: {
          type: "object",
          properties: {
            timeframe: { type: "string", enum: ["today", "week", "season"] },
            date: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { timeframe: rawTimeframe, date } = request.query as { timeframe?: string; date?: string };
      const timeframe = (rawTimeframe ?? "today") as Timeframe;
      const member = await requireLeagueMembership(request.user!.id, leagueId);

      const [leagueRow] = await db.select({ timezone: league.timezone }).from(league).where(eq(league.id, leagueId)).limit(1);
      const resolvedDate = date ?? DateTime.now().setZone(leagueRow!.timezone).toISODate()!;

      const current = await computeStandings(leagueId, timeframe, resolvedDate);

      let rankChangeByMember: Map<string, number | null> | null = null;
      if (timeframe !== "season") {
        const priorDate =
          timeframe === "today"
            ? DateTime.fromISO(resolvedDate, { zone: leagueRow!.timezone }).minus({ days: 1 }).toISODate()!
            : DateTime.fromISO(resolvedDate, { zone: leagueRow!.timezone }).minus({ weeks: 1 }).toISODate()!;
        const prior = await computeStandings(leagueId, timeframe, priorDate);
        const priorRankByMember = new Map(prior.map((p) => [p.leagueMemberId, p.rank]));
        rankChangeByMember = new Map(
          current.map((c) => {
            const priorRank = priorRankByMember.get(c.leagueMemberId);
            return [c.leagueMemberId, priorRank === undefined ? null : priorRank - c.rank] as [string, number | null];
          }),
        );
      }

      return {
        timeframe,
        date: resolvedDate,
        callerLeagueMemberId: member.id,
        standings: current.map((entry) => ({
          ...entry,
          rankChange: rankChangeByMember?.get(entry.leagueMemberId) ?? null,
        })),
      };
    },
  );

  /**
   * Games x members grid for one locked/finished slate (JAC-37-42
   * requirement 6). Only LOCKED games appear at all — inherits Epic 5's
   * visibility rule (games still open are omitted entirely, not just
   * picks hidden, since comparing an in-progress slate isn't the point
   * of this view). `split`/`allWrong` are computed server-side, same
   * philosophy as the slate endpoint's `pickState` — a client never
   * re-derives the rule that makes a game interesting.
   */
  app.get(
    "/:leagueId/head-to-head",
    {
      schema: {
        params: { type: "object", required: ["leagueId"], properties: { leagueId: { type: "string" } } },
        querystring: { type: "object", properties: { date: { type: "string", format: "date" } } },
      },
    },
    async (request) => {
      const { leagueId } = request.params as { leagueId: string };
      const { date } = request.query as { date?: string };
      await requireLeagueMembership(request.user!.id, leagueId);

      const [leagueRow] = await db
        .select({ sports: league.sports, timezone: league.timezone })
        .from(league)
        .where(eq(league.id, leagueId))
        .limit(1);

      const resolvedDate = date ?? DateTime.now().setZone(leagueRow!.timezone).toISODate()!;
      const { start, end } = dayBoundsUtc(resolvedDate, leagueRow!.timezone);

      const sportsSql = sql.join(
        leagueRow!.sports.map((s) => sql`${s}`),
        sql`, `,
      );

      // NOTE: db.execute()'s raw path returns timestamptz columns as
      // Postgres's text representation, not a JS Date (see
      // lib/standings.ts's fetchClusterPicks comment) — starts_at is
      // converted below before it goes into the response.
      const rowsResult = await db.execute<{
        game_id: string;
        home_team: string;
        away_team: string;
        starts_at: string;
        winning_team: string | null;
        picks: Array<{ leagueMemberId: string; displayName: string; selectedTeam: string | null }>;
      }>(sql`
        select
          g.id as game_id, g.home_team, g.away_team, g.starts_at, r.winning_team,
          json_agg(json_build_object(
            'leagueMemberId', lm.id,
            'displayName', u.display_name,
            'selectedTeam', p.selected_team
          ) order by u.display_name) as picks
        from game g
        left join result r on r.game_id = g.id
        cross join league_member lm
        join "user" u on u.id = lm.user_id
        left join pick p on p.game_id = g.id and p.league_member_id = lm.id
        where g.sport in (${sportsSql})
          and g.starts_at >= ${start} and g.starts_at < ${end}
          and now() >= g.starts_at
          and lm.league_id = ${leagueId} and lm.left_at is null
        group by g.id, g.home_team, g.away_team, g.starts_at, r.winning_team
        order by g.starts_at
      `);

      const games = rowsResult.rows.map((row) => {
        const picks = row.picks.map((p) => ({
          ...p,
          hit: row.winning_team === null ? null : p.selectedTeam === row.winning_team,
        }));
        const pickedSelections = picks.map((p) => p.selectedTeam).filter((t): t is string => t !== null);
        const split = new Set(pickedSelections).size > 1;
        const allWrong =
          row.winning_team !== null &&
          pickedSelections.length > 0 &&
          pickedSelections.every((t) => t !== row.winning_team);

        return {
          gameId: row.game_id,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          startsAt: new Date(row.starts_at),
          winningTeam: row.winning_team,
          picks,
          split,
          allWrong,
        };
      });

      return { date: resolvedDate, games };
    },
  );

  /**
   * Manual result correction (JAC-40), commissioner-only. `game`/
   * `result` are global (shared across every league covering that
   * sport, since Epic 1) — a deliberate, accepted blast radius: any
   * commissioner of any league whose sports cover this game can correct
   * it, which can affect OTHER leagues too. No new permission system
   * for this (there's no platform-admin role anywhere in this app, and
   * building one is scope creep beyond this epic) — the mitigation is
   * full transparency instead, via the required `reason` and the
   * queryable result_correction history below, visible to every
   * affected league's members, not just the one who triggered it.
   *
   * Requires the game already HAS a result — this corrects an existing
   * result, not manually grading a game score-poll never touched
   * (that's a different, unasked-for feature).
   */
  app.post(
    "/:leagueId/games/:gameId/correct-result",
    {
      schema: {
        params: {
          type: "object",
          required: ["leagueId", "gameId"],
          properties: { leagueId: { type: "string" }, gameId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["winningTeam", "reason"],
          properties: {
            winningTeam: { type: "string", minLength: 1 },
            reason: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { leagueId, gameId } = request.params as { leagueId: string; gameId: string };
      const { winningTeam, reason } = request.body as { winningTeam: string; reason: string };
      await requireLeagueCommissioner(request.user!.id, leagueId);

      const [leagueRow] = await db.select({ sports: league.sports }).from(league).where(eq(league.id, leagueId)).limit(1);
      const [gameRow] = await db.select().from(game).where(eq(game.id, gameId)).limit(1);
      if (!gameRow || !leagueRow!.sports.includes(gameRow.sport)) {
        throw new ApiError("GAME_NOT_FOUND", "Not part of this league's slate", 404);
      }

      const [resultRow] = await db.select().from(result).where(eq(result.gameId, gameId)).limit(1);
      if (!resultRow) {
        throw new ApiError("RESULT_NOT_FOUND", "This game has no result to correct yet", 404);
      }

      const validSelections = gameRow.allowsDraw
        ? [gameRow.homeTeam, gameRow.awayTeam, "DRAW"]
        : [gameRow.homeTeam, gameRow.awayTeam];
      if (!validSelections.includes(winningTeam)) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "winningTeam", message: `must be one of: ${validSelections.join(", ")}` },
        ]);
      }
      if (winningTeam === resultRow.winningTeam) {
        throw new ApiError("NO_CHANGE", "New winning team matches the current result", 400);
      }

      const { correction, affectedMembers } = await db.transaction(async (tx) => {
        const before = await tx
          .select({ leagueMemberId: pick.leagueMemberId, outcome: pick.outcome })
          .from(pick)
          .where(and(eq(pick.gameId, gameId), inArray(pick.outcome, ["win", "loss"])));

        await tx.update(result).set({ winningTeam }).where(eq(result.gameId, gameId));
        await regradeGame(gameId, winningTeam, tx as unknown as typeof db);

        const [correction] = await tx
          .insert(resultCorrection)
          .values({
            gameId,
            oldWinningTeam: resultRow.winningTeam,
            newWinningTeam: winningTeam,
            source: "manual",
            correctedByUserId: request.user!.id,
            correctedFromLeagueId: leagueId,
            reason,
          })
          .returning();

        const memberIds = before.map((b) => b.leagueMemberId);
        const after =
          memberIds.length > 0
            ? await tx
                .select({ leagueMemberId: pick.leagueMemberId, outcome: pick.outcome })
                .from(pick)
                .where(and(eq(pick.gameId, gameId), inArray(pick.leagueMemberId, memberIds)))
            : [];
        const afterByMember = new Map(after.map((a) => [a.leagueMemberId, a.outcome]));
        const affectedMembers = before.map((b) => ({
          leagueMemberId: b.leagueMemberId,
          oldOutcome: b.outcome,
          newOutcome: afterByMember.get(b.leagueMemberId) ?? null,
        }));

        return { correction: correction!, affectedMembers };
      });

      return { correction, affectedMembers };
    },
  );

  /**
   * Correction history — member-readable (not commissioner-only; the
   * requirement is about notifying members, not hiding this from them),
   * cursor-paginated per the established convention. Scoped to games
   * whose sport this league covers, same as every other game-touching
   * query here — a correction on a game shared with another league
   * (global game/result) intentionally still shows up here, matching
   * the transparency tradeoff above.
   */
  app.get(
    "/:leagueId/corrections",
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

      const [leagueRow] = await db.select({ sports: league.sports }).from(league).where(eq(league.id, leagueId)).limit(1);

      const limit = Math.min(rawLimit ?? CORRECTIONS_PAGE_DEFAULT_LIMIT, CORRECTIONS_PAGE_MAX_LIMIT);
      const decoded = cursor ? decodeCorrectionsCursor(cursor) : null;
      if (cursor && !decoded) {
        throw new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [
          { field: "cursor", message: "invalid cursor" },
        ]);
      }

      const rows = await db
        .select({
          id: resultCorrection.id,
          gameId: resultCorrection.gameId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          oldWinningTeam: resultCorrection.oldWinningTeam,
          newWinningTeam: resultCorrection.newWinningTeam,
          source: resultCorrection.source,
          correctedByUserId: resultCorrection.correctedByUserId,
          correctedFromLeagueId: resultCorrection.correctedFromLeagueId,
          reason: resultCorrection.reason,
          createdAt: resultCorrection.createdAt,
        })
        .from(resultCorrection)
        .innerJoin(game, eq(game.id, resultCorrection.gameId))
        .where(
          and(
            inArray(game.sport, leagueRow!.sports),
            decoded
              ? sql`(date_trunc('milliseconds', ${resultCorrection.createdAt}), ${resultCorrection.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id})`
              : undefined,
          ),
        )
        .orderBy(sql`date_trunc('milliseconds', ${resultCorrection.createdAt})`, resultCorrection.id)
        .limit(limit + 1);

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page,
        pagination: {
          next_cursor: hasNext && last ? encodeCorrectionsCursor(last.createdAt, last.id) : null,
          limit,
        },
      };
    },
  );
}
