import { pathToFileURL } from "node:url";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { logger } from "../lib/logger.js";
import { createSportsProvider } from "../lib/sports-provider.js";

/**
 * Entry point for the scheduled score-polling job (Render Cron Job).
 * Kept a thin foundation stub for this phase: it proves the job runs on
 * schedule, logs structured start/success/failure, reports to error
 * tracking and the dedicated job-failure heartbeat (JAC-11), and exits
 * non-zero on failure. Actual score-ingestion/grading logic is a product
 * feature for a later phase.
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

// `'file://' + process.argv[1]` (a common pattern for this check) breaks
// on Windows and on any path containing spaces — pathToFileURL handles
// drive letters, backslashes, and encoding correctly on every platform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking();
  runScorePoll()
    .then(() => pingHeartbeat("success"))
    .catch(async (err) => {
      logger.error({ job: "score-poll", err }, "score-poll failed");
      captureException(err);
      await pingHeartbeat("fail");
      // Set the exit code and let Node exit naturally once the event loop
      // drains, rather than calling process.exit() directly — Pino's
      // stdout writes are async, and a forced exit can cut them off
      // before they flush (silently losing exactly the failure log this
      // job most needs to produce).
      process.exitCode = 1;
    });
}
