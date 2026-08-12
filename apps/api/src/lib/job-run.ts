import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { jobRun } from "../db/schema.js";

/**
 * Cross-run memory for the scheduled jobs (JAC-24) — written once per
 * run, at the end, whether it succeeded or a caught failure. A
 * cron-triggered process has no in-memory state between invocations, so
 * this table is what "has this job succeeded recently" and "did the
 * last run find anything" actually query against.
 */
export interface RecordJobRunInput {
  jobName: string;
  startedAt: Date;
  finishedAt: Date;
  succeeded: boolean;
  itemCount: number | null;
  errorMessage: string | null;
}

export async function recordJobRun(input: RecordJobRunInput): Promise<void> {
  await db.insert(jobRun).values(input);
}

export interface JobRunStatus {
  jobName: string;
  lastRunAt: Date | null;
  lastRunSucceeded: boolean | null;
  lastSuccessAt: Date | null;
}

/** Powers /health/data-freshness — see routes/health.routes.ts. */
export async function getJobRunStatus(jobName: string): Promise<JobRunStatus> {
  const [latest] = await db
    .select()
    .from(jobRun)
    .where(eq(jobRun.jobName, jobName))
    .orderBy(desc(jobRun.startedAt))
    .limit(1);

  const [latestSuccess] = await db
    .select()
    .from(jobRun)
    .where(and(eq(jobRun.jobName, jobName), eq(jobRun.succeeded, true)))
    .orderBy(desc(jobRun.startedAt))
    .limit(1);

  return {
    jobName,
    lastRunAt: latest?.startedAt ?? null,
    lastRunSucceeded: latest?.succeeded ?? null,
    lastSuccessAt: latestSuccess?.startedAt ?? null,
  };
}
