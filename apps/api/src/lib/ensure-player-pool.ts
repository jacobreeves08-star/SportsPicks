import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { nflAthlete } from "../db/schema.js";
import { runNflAthleteIngest } from "../jobs/nfl-athlete-ingest.js";
import { captureException } from "./error-tracking.js";
import { logger } from "./logger.js";

/**
 * Loads the college quiz's player pool on boot if — and only if — it is
 * completely empty (docs/college-trivia.md).
 *
 * A safety net for one specific situation: an environment where
 * `nfl-athlete-ingest` has never run and has no way to. The job is
 * designed to run weekly as a cron service, but Render's cron services
 * (and its shell) are paid features, so on a free instance there is no
 * other path by which the pool can ever become non-empty — and a quiz
 * with no players is the whole feature failing to exist.
 *
 * Deliberately narrow, so this never becomes a second, accidental
 * scheduler competing with the real job:
 *
 *  - **Empty means empty.** One row is enough to skip. This tops up
 *    nothing and refreshes nothing; a stale pool is fully playable (a
 *    player's college never changes), so there is nothing here worth
 *    re-fetching on a restart.
 *  - **Never blocks startup.** Called after `listen`, not before, and
 *    not awaited. A full ingest is ~33 upstream requests and takes
 *    minutes; doing it before the port opens would fail the platform's
 *    health check and turn a slow ESPN into a failed deploy.
 *  - **Never takes the API down.** Every failure is logged and reported
 *    and then swallowed. An unreachable ESPN means the quiz reports
 *    "no quiz today" for now, which is exactly what it's built to do —
 *    it must not also mean the rest of the app stops serving.
 */
export async function ensurePlayerPool(): Promise<void> {
  try {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(nflAthlete);

    if ((row?.count ?? 0) > 0) return;

    logger.warn({ job: "nfl-athlete-ingest" }, "player pool is empty — running the ingest once at startup");
    await runNflAthleteIngest();
    logger.info({ job: "nfl-athlete-ingest" }, "startup player-pool ingest finished");
  } catch (err) {
    // Swallowed on purpose — see this module's header.
    logger.error({ err }, "startup player-pool ingest failed; the quiz will report no puzzle until it succeeds");
    captureException(err);
  }
}
