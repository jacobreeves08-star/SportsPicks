import { logger } from "../lib/logger.js";
import { createSportsProvider } from "../lib/sports-provider.js";

/**
 * Entry point for the scheduled score-polling job (Render Cron Job).
 * Kept a thin foundation stub for this phase: it proves the job runs on
 * schedule, logs structured start/success/failure, and exits non-zero on
 * failure so the platform's job-failure alert (JAC-11) fires. Actual
 * score-ingestion/grading logic is a product feature for a later phase.
 */
export async function runScorePoll(): Promise<void> {
  const startedAt = Date.now();
  logger.info({ job: "score-poll" }, "score-poll started");

  const provider = createSportsProvider();
  const updates = await provider.fetchUpdates();

  logger.info(
    { job: "score-poll", updateCount: updates.length, durationMs: Date.now() - startedAt },
    "score-poll completed",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScorePoll()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ job: "score-poll", err }, "score-poll failed");
      process.exit(1);
    });
}
