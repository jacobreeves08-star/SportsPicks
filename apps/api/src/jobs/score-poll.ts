import { pathToFileURL } from "node:url";
import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, result } from "../db/schema.js";
import { captureException, captureMessage, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { findStaleGames } from "../lib/game-staleness.js";
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
            await tx
              .update(game)
              .set({ status: canonicalResult.status })
              .where(and(eq(game.id, candidate.id), ne(game.status, "final")));
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
          return true;
        });

        if (transitionedToFinal) itemCount += 1;
      }
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
      { job: "score-poll", itemCount, durationMs: finishedAt.getTime() - startedAt.getTime() },
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
