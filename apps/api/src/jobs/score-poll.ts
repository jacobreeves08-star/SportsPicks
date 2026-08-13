import { pathToFileURL } from "node:url";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, result, resultCorrection } from "../db/schema.js";
import { captureException, captureMessage, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { findStaleGames } from "../lib/game-staleness.js";
import { gradeFinalGame, regradeGame, voidGamePicks } from "../lib/grading.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";
import { logger } from "../lib/logger.js";
import {
  createSportsProvider,
  toYyyyMmDd,
  type FetchResultsParams,
  type SportsProvider,
} from "../lib/sports-provider.js";

/**
 * Entry point for the scheduled score-polling job (Render Cron Job) —
 * see docs/sports-pipeline.md. Polls ONLY games whose start has passed
 * and whose status isn't already final — never the whole slate, so a
 * quiet afternoon with nothing live costs zero ESPN calls, not because
 * of any special "back off" logic but because the candidate query
 * itself returns nothing to poll.
 *
 * Finalization is exactly-once by construction: a game only transitions
 * to 'final' via a conditional UPDATE ... WHERE status != 'final', and
 * the accompanying `result` row is written in the SAME transaction, so
 * "final with no result row" can never be observed even mid-crash.
 * Re-running against an already-final game is a guaranteed no-op.
 *
 * Grading (JAC-37-42) happens in that same transaction too: every pick
 * on a game that just finalized is graded win/loss against the winning
 * team, and every pick on a game that just transitioned to postponed/
 * cancelled is voided — see lib/grading.ts and
 * docs/scoring-and-standings.md. A separate bounded reconciliation
 * sweep below self-heals any postponed/cancelled game whose picks
 * somehow missed that.
 */
export async function runScorePoll(providerOverride?: SportsProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: "score-poll" }, "score-poll started");

  try {
    const provider = providerOverride ?? createSportsProvider();

    const candidates = await db
      .select({
        id: game.id,
        externalId: game.externalId,
        sport: game.sport,
        startsAt: game.startsAt,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
      })
      .from(game)
      .where(and(inArray(game.status, ["scheduled", "in_progress"]), lte(game.startsAt, startedAt)));

    let itemCount = 0;

    const pollable = candidates.filter(
      (c): c is typeof c & { externalId: string } => c.externalId !== null,
    );

    if (pollable.length > 0) {
      const fetchParams: FetchResultsParams[] = pollable.map((c) => ({
        externalId: c.externalId,
        sport: c.sport,
        date: toYyyyMmDd(c.startsAt),
      }));

      const results = await provider.fetchResults(fetchParams);
      const resultByExternalId = new Map(results.map((r) => [r.externalId, r]));

      for (const candidate of pollable) {
        const canonicalResult = resultByExternalId.get(candidate.externalId);
        if (!canonicalResult) continue; // provider had nothing new for this game this cycle

        const transitionedToFinal = await db.transaction(async (tx) => {
          if (canonicalResult.status !== "final") {
            // Not final yet — keep status current (in_progress, or a
            // postponement/cancellation discovered mid-slate), guarded
            // the same way so a late/out-of-order response can never
            // downgrade an already-final game.
            const updated = await tx
              .update(game)
              .set({ status: canonicalResult.status })
              .where(and(eq(game.id, candidate.id), ne(game.status, "final")))
              .returning({ id: game.id });

            // A genuine transition into postponed/cancelled (score-poll's
            // own candidate query only ever selects scheduled/in_progress
            // games, so this can never be a re-affirmation of an already-
            // postponed/cancelled row) voids every ungraded pick on it —
            // postponed/cancelled games are voided for everyone, never
            // counted as a loss. See docs/scoring-and-standings.md.
            if (
              updated.length > 0 &&
              (canonicalResult.status === "postponed" || canonicalResult.status === "canceled")
            ) {
              await voidGamePicks(candidate.id, tx as unknown as typeof db);
            }
            return false;
          }

          if (canonicalResult.winnerSide === null) {
            // Contract violation from the adapter (status final with no
            // winner side) — log and skip rather than write a garbage
            // result. Should be unreachable given mapEventToResult's
            // own invariant, but never trust that silently.
            logger.warn(
              { job: "score-poll", gameId: candidate.id },
              "score-poll: final result had no winnerSide, skipping",
            );
            return false;
          }

          const updated = await tx
            .update(game)
            .set({ status: "final" })
            .where(and(eq(game.id, candidate.id), ne(game.status, "final")))
            .returning({ id: game.id });

          if (updated.length === 0) return false; // already final — no-op, exactly-once

          const winningTeam =
            canonicalResult.winnerSide === "draw"
              ? "DRAW"
              : canonicalResult.winnerSide === "home"
                ? candidate.homeTeam
                : candidate.awayTeam;

          await tx.insert(result).values({ gameId: candidate.id, winningTeam, source: "espn" });
          await gradeFinalGame(candidate.id, winningTeam, tx as unknown as typeof db);
          return true;
        });

        if (transitionedToFinal) itemCount += 1;
      }
    }

    // Automatic revision detection (JAC-37-42): providers DO publish
    // corrections (scoring reviews, forfeits, data errors). Re-fetches
    // results for games that finalized within REVISION_CHECK_WINDOW_HOURS
    // — based on result.created_at, written exactly once at insert, NOT
    // game.updated_at (see env.ts's comment for why that's unsafe: it
    // gets bumped by routine, unrelated writes like a team-name
    // correction on a long-final game). If the freshly-fetched winner
    // differs from the stored one, regrades every pick on that game and
    // records a result_correction — see docs/scoring-and-standings.md.
    const revisionWindowStart = new Date(startedAt.getTime() - env.REVISION_CHECK_WINDOW_HOURS * 60 * 60 * 1000);
    const revisionCandidates = await db
      .select({
        id: game.id,
        externalId: game.externalId,
        sport: game.sport,
        startsAt: game.startsAt,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        storedWinningTeam: result.winningTeam,
      })
      .from(game)
      .innerJoin(result, eq(result.gameId, game.id))
      .where(and(eq(game.status, "final"), gte(result.createdAt, revisionWindowStart)));

    const revisionPollable = revisionCandidates.filter(
      (c): c is typeof c & { externalId: string } => c.externalId !== null,
    );

    let revisionCount = 0;
    if (revisionPollable.length > 0) {
      const revisionFetchParams: FetchResultsParams[] = revisionPollable.map((c) => ({
        externalId: c.externalId,
        sport: c.sport,
        date: toYyyyMmDd(c.startsAt),
      }));

      const revisionResults = await provider.fetchResults(revisionFetchParams);
      const revisionByExternalId = new Map(revisionResults.map((r) => [r.externalId, r]));

      for (const candidate of revisionPollable) {
        const canonicalResult = revisionByExternalId.get(candidate.externalId);
        if (!canonicalResult || canonicalResult.status !== "final" || canonicalResult.winnerSide === null) {
          continue;
        }

        const freshWinningTeam =
          canonicalResult.winnerSide === "draw"
            ? "DRAW"
            : canonicalResult.winnerSide === "home"
              ? candidate.homeTeam
              : candidate.awayTeam;

        if (freshWinningTeam === candidate.storedWinningTeam) continue; // no revision

        const oldWinningTeam = candidate.storedWinningTeam;
        await db.transaction(async (tx) => {
          await tx.update(result).set({ winningTeam: freshWinningTeam }).where(eq(result.gameId, candidate.id));
          await regradeGame(candidate.id, freshWinningTeam, tx as unknown as typeof db);
          await tx.insert(resultCorrection).values({
            gameId: candidate.id,
            oldWinningTeam,
            newWinningTeam: freshWinningTeam,
            source: "provider_revision",
          });
        });
        revisionCount += 1;

        logger.warn(
          { job: "score-poll", gameId: candidate.id, oldWinningTeam, newWinningTeam: freshWinningTeam },
          "score-poll: provider revised a previously-final result",
        );
        captureMessage("score-poll: provider revised a previously-final result", {
          gameId: candidate.id,
          oldWinningTeam,
          newWinningTeam: freshWinningTeam,
        });
      }
    }

    // Reconciliation sweep (JAC-37-42): a bounded, self-healing safety
    // net for the case a postponed/cancelled transition's own void call
    // above got missed (a crash, a bug) — a cancelled game in particular
    // has no other recovery path once its date falls outside schedule-
    // ingest's rolling lookback window, unlike postponed games, which
    // keep reappearing via schedule-ingest's own unbounded postponed-
    // game recovery pass. See docs/scoring-and-standings.md. Cheap:
    // most historical picks are already graded, so this is highly
    // selective once scoped to postponed/cancelled games specifically.
    const needsReconciliation = await db.execute<{ id: string }>(sql`
      select g.id from game g
      where g.status in ('postponed', 'canceled')
        and exists (select 1 from pick p where p.game_id = g.id and p.outcome is null)
      order by g.starts_at desc
      limit 50
    `);
    for (const row of needsReconciliation.rows) {
      await voidGamePicks(row.id, db);
    }
    if (needsReconciliation.rows.length > 0) {
      logger.info(
        { job: "score-poll", reconciledCount: needsReconciliation.rows.length },
        "reconciliation sweep voided ungraded picks on postponed/cancelled games",
      );
    }

    const staleGames = await findStaleGames();
    if (staleGames.length > 0) {
      captureMessage(`score-poll: ${staleGames.length} game(s) past expected end without a final result`, {
        gameIds: staleGames.map((g) => g.id),
      });
      logger.warn(
        { job: "score-poll", staleCount: staleGames.length },
        "games past expected end without a final result",
      );
    }

    const finishedAt = new Date();
    await recordJobRun({
      jobName: "score-poll",
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount,
      errorMessage: null,
    });

    logger.info(
      { job: "score-poll", itemCount, revisionCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "score-poll completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: "score-poll",
      startedAt,
      finishedAt: new Date(),
      succeeded: false,
      itemCount: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runScorePoll()
    .then(() => pingHeartbeat(env.HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: "score-poll", err }, "score-poll failed");
      captureException(err);
      await pingHeartbeat(env.HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
