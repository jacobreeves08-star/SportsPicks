import type { FastifyInstance } from "fastify";
import { findStaleGames } from "../lib/game-staleness.js";
import { getJobRunStatus } from "../lib/job-run.js";
import { nowUtc } from "../lib/time.js";

const TRACKED_JOBS = ["schedule-ingest", "score-poll", "anonymize-accounts"] as const;

/**
 * Documented (not yet consumed — no frontend exists in this repo) hook
 * for a future stale-data banner (JAC-24), and a genuinely useful
 * ops-visibility endpoint on its own. No auth, no PII — matches the
 * existing bare /health liveness check's public status. Registered
 * with no prefix; the route paths below are the full paths.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/data-freshness", async () => {
    const jobs = await Promise.all(TRACKED_JOBS.map((jobName) => getJobRunStatus(jobName)));
    const staleGames = await findStaleGames();

    return {
      jobs,
      staleGameCount: staleGames.length,
      generatedAt: nowUtc().toJSDate(),
    };
  });
}
