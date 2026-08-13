import { pathToFileURL } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { jobRun } from "../db/schema.js";
import { createEmailProvider, type EmailProvider } from "../lib/email-provider.js";
import { captureException, initErrorTracking } from "../lib/error-tracking.js";
import { env } from "../lib/env.js";
import { pingHeartbeat } from "../lib/heartbeat.js";
import { recordJobRun } from "../lib/job-run.js";
import { logger } from "../lib/logger.js";
import { getOpsSummary } from "../lib/ops-summary.js";

const JOB_NAME = "operator-digest";

/**
 * Entry point for the daily closed-beta ops digest (Render Cron Job,
 * `0 13 * * *`) — JAC-48. Emails getOpsSummary()'s output to a single
 * static operator recipient (env.OPERATOR_EMAIL). This is the tool
 * that makes "seven consecutive days where nobody had to ask what
 * happened" checkable without anyone remembering to curl
 * /health/data-freshness themselves.
 *
 * Unset OPERATOR_EMAIL -> no-op with a warning log, matching this
 * app's "unset env var = no-op" convention everywhere else
 * (HEARTBEAT_URL, SENTRY_DSN). Still records a job_run either way, so
 * /health/data-freshness itself can show this job as healthy even
 * while it's intentionally not configured to send anywhere.
 *
 * Idempotency: a single static recipient needs no per-recipient
 * notification_log granularity (that mechanism exists specifically
 * for per-member fan-out — see docs/notifications.md) — a plain check
 * against job_run for an already-succeeded run today is enough. This
 * mostly guards a manual re-trigger or retry on the same day, since
 * the cron schedule itself only fires once daily.
 */
export async function runOperatorDigest(emailProviderOverride?: EmailProvider): Promise<void> {
  const startedAt = new Date();
  logger.info({ job: JOB_NAME }, "operator-digest started");

  try {
    if (!env.OPERATOR_EMAIL) {
      logger.warn({ job: JOB_NAME }, "OPERATOR_EMAIL not set, skipping");
      await recordJobRun({
        jobName: JOB_NAME,
        startedAt,
        finishedAt: new Date(),
        succeeded: true,
        itemCount: 0,
        errorMessage: null,
      });
      return;
    }

    const todayUtc = DateTime.now().setZone("utc").toISODate();
    const [lastSuccess] = await db
      .select({ startedAt: jobRun.startedAt })
      .from(jobRun)
      .where(and(eq(jobRun.jobName, JOB_NAME), eq(jobRun.succeeded, true)))
      .orderBy(desc(jobRun.startedAt))
      .limit(1);

    if (lastSuccess && DateTime.fromJSDate(lastSuccess.startedAt, { zone: "utc" }).toISODate() === todayUtc) {
      logger.info({ job: JOB_NAME }, "already sent today, skipping");
      await recordJobRun({
        jobName: JOB_NAME,
        startedAt,
        finishedAt: new Date(),
        succeeded: true,
        itemCount: 0,
        errorMessage: null,
      });
      return;
    }

    const emailProvider = emailProviderOverride ?? createEmailProvider();
    const summary = await getOpsSummary();
    await emailProvider.sendOperatorDigestEmail(env.OPERATOR_EMAIL, summary);

    const finishedAt = new Date();
    await recordJobRun({
      jobName: JOB_NAME,
      startedAt,
      finishedAt,
      succeeded: true,
      itemCount: 1,
      errorMessage: null,
    });
    logger.info(
      { job: JOB_NAME, durationMs: finishedAt.getTime() - startedAt.getTime() },
      "operator-digest completed",
    );
  } catch (err) {
    await recordJobRun({
      jobName: JOB_NAME,
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
  runOperatorDigest()
    .then(() => pingHeartbeat(env.OPERATOR_DIGEST_HEARTBEAT_URL, "success"))
    .catch(async (err) => {
      logger.error({ job: JOB_NAME, err }, "operator-digest failed");
      captureException(err);
      await pingHeartbeat(env.OPERATOR_DIGEST_HEARTBEAT_URL, "fail");
      process.exitCode = 1;
    });
}
