import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { nflAthlete } from "../db/schema.js";
import { runNflAthleteIngest } from "../jobs/nfl-athlete-ingest.js";
import { captureException } from "./error-tracking.js";
import { logger } from "./logger.js";

/**
 * Loads the college quiz's player pool on boot if — and only if — it
 * is missing something no other mechanism will ever supply
 * (docs/college-trivia.md).
 *
 * A safety net for one specific situation: an environment where
 * `nfl-athlete-ingest` has never run and has no way to. The job is
 * designed to run weekly as a cron service, but Render's cron services
 * (and its shell) are paid features, so on a free instance there is no
 * other path by which the pool can ever become non-empty — and a quiz
 * with no players is the whole feature failing to exist.
 *
 * Deliberately narrow, so this never becomes a second, accidental
 * scheduler competing with the real job. It runs in exactly two
 * self-disabling cases, and refreshes nothing otherwise:
 *
 *  - **The pool is completely empty.** One row is enough to skip. A
 *    stale pool is fully playable (a player's college never changes),
 *    so there is nothing here worth re-fetching on a restart.
 *  - **The pool predates the starter flag.** Rows exist but not one is
 *    a depth-chart starter, which is not a state a real league can be
 *    in — it means the pool was ingested before `is_starter` existed
 *    (migration 0016), and without this run the flag would stay false
 *    on a cron-less instance FOREVER, quietly keeping the quiz on
 *    third-stringers. The moment one starter lands, this branch never
 *    fires again.
 *  - **Never blocks startup.** Called after `listen`, not before, and
 *    not awaited. A full ingest is ~65 upstream requests and takes
 *    minutes; doing it before the port opens would fail the platform's
 *    health check and turn a slow ESPN into a failed deploy.
 *  - **Never takes the API down.** Every failure is logged and reported
 *    and then swallowed. An unreachable ESPN means the quiz reports
 *    "no quiz today" for now, which is exactly what it's built to do —
 *    it must not also mean the rest of the app stops serving.
 */
export async function ensurePlayerPool(): Promise<void> {
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        starterCount: sql<number>`count(*) filter (where ${nflAthlete.isStarter})::int`,
      })
      .from(nflAthlete);

    const poolCount = row?.count ?? 0;
    const starterCount = row?.starterCount ?? 0;

    if (poolCount > 0 && starterCount > 0) return;

    if (poolCount === 0) {
      logger.warn({ job: "nfl-athlete-ingest" }, "player pool is empty — running the ingest once at startup");
    } else {
      logger.warn(
        { job: "nfl-athlete-ingest", poolCount },
        "player pool has no depth-chart starters (ingested before is_starter existed) — running the ingest once at startup",
      );
    }
    await runNflAthleteIngest();
    logger.info({ job: "nfl-athlete-ingest" }, "startup player-pool ingest finished");
  } catch (err) {
    // Swallowed on purpose — see this module's header.
    logger.error({ err }, "startup player-pool ingest failed; the quiz will report no puzzle until it succeeds");
    captureException(err);
  }
}
