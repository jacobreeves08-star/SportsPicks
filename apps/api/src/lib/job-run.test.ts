import { beforeEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../db/test-helpers.js";
import { getJobRunStatus, recordJobRun } from "./job-run.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("recordJobRun / getJobRunStatus", () => {
  it("returns all-null status when a job has never run", async () => {
    const status = await getJobRunStatus("never-run-job");
    expect(status).toEqual({
      jobName: "never-run-job",
      lastRunAt: null,
      lastRunSucceeded: null,
      lastSuccessAt: null,
    });
  });

  it("reflects a single successful run", async () => {
    const startedAt = new Date("2026-08-12T10:00:00.000Z");
    await recordJobRun({
      jobName: "score-poll",
      startedAt,
      finishedAt: new Date("2026-08-12T10:00:01.000Z"),
      succeeded: true,
      itemCount: 3,
      errorMessage: null,
    });

    const status = await getJobRunStatus("score-poll");
    expect(status.lastRunAt).toEqual(startedAt);
    expect(status.lastRunSucceeded).toBe(true);
    expect(status.lastSuccessAt).toEqual(startedAt);
  });

  it("lastRunAt reflects the most recent run even if it failed, but lastSuccessAt stays at the prior success", async () => {
    const success = new Date("2026-08-12T09:00:00.000Z");
    const failure = new Date("2026-08-12T10:00:00.000Z");

    await recordJobRun({
      jobName: "schedule-ingest",
      startedAt: success,
      finishedAt: success,
      succeeded: true,
      itemCount: 10,
      errorMessage: null,
    });
    await recordJobRun({
      jobName: "schedule-ingest",
      startedAt: failure,
      finishedAt: failure,
      succeeded: false,
      itemCount: null,
      errorMessage: "ESPN unreachable",
    });

    const status = await getJobRunStatus("schedule-ingest");
    expect(status.lastRunAt).toEqual(failure);
    expect(status.lastRunSucceeded).toBe(false);
    expect(status.lastSuccessAt).toEqual(success);
  });

  it("does not mix up different jobs' status", async () => {
    await recordJobRun({
      jobName: "score-poll",
      startedAt: new Date(),
      finishedAt: new Date(),
      succeeded: true,
      itemCount: 1,
      errorMessage: null,
    });

    const other = await getJobRunStatus("schedule-ingest");
    expect(other.lastRunAt).toBeNull();
  });
});
