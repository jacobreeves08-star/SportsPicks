import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createTestGame, createTestJobRun, truncateAllTables } from "../db/test-helpers.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("GET /health/data-freshness", () => {
  it("requires no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.statusCode).toBe(200);
  });

  it("returns null job status when neither job has ever run", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const body = res.json();
    expect(body.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobName: "schedule-ingest", lastRunAt: null, lastSuccessAt: null }),
        expect.objectContaining({ jobName: "score-poll", lastRunAt: null, lastSuccessAt: null }),
      ]),
    );
    expect(body.staleGameCount).toBe(0);
  });

  it("reflects a successful run", async () => {
    await createTestJobRun({ jobName: "score-poll", succeeded: true, itemCount: 2 });
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const scorePoll = res.json().jobs.find((j: { jobName: string }) => j.jobName === "score-poll");
    expect(scorePoll.lastRunSucceeded).toBe(true);
    expect(scorePoll.lastSuccessAt).not.toBeNull();
  });

  it("reflects a failed run distinctly from lastSuccessAt", async () => {
    await createTestJobRun({ jobName: "schedule-ingest", succeeded: false, errorMessage: "boom" });
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    const scheduleIngest = res.json().jobs.find((j: { jobName: string }) => j.jobName === "schedule-ingest");
    expect(scheduleIngest.lastRunSucceeded).toBe(false);
    expect(scheduleIngest.lastSuccessAt).toBeNull();
  });

  it("staleGameCount reflects findStaleGames", async () => {
    await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(10) }); // stale
    await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(1) }); // not stale

    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().staleGameCount).toBe(1);
  });

  it("returns ISO-8601 UTC timestamps, per api-conventions", async () => {
    const res = await app.inject({ method: "GET", url: "/health/data-freshness" });
    expect(res.json().generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
