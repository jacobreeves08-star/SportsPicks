import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { jobRun } from "../db/schema.js";
import { createTestNflAthlete, truncateAllTables } from "../db/test-helpers.js";
import { ensurePlayerPool } from "./ensure-player-pool.js";

// Under the test env's mock provider the ingest fetches nothing, so
// "did ensurePlayerPool decide to run it" is observable through the
// job_run row the ingest always records — no network, no stubbing.
async function ingestRuns(): Promise<number> {
  const rows = await db.select().from(jobRun).where(eq(jobRun.jobName, "nfl-athlete-ingest"));
  return rows.length;
}

beforeEach(async () => {
  await truncateAllTables();
});

describe("ensurePlayerPool", () => {
  it("runs the ingest when the pool is completely empty", async () => {
    await ensurePlayerPool();

    expect(await ingestRuns()).toBe(1);
  });

  it("runs the ingest when rows exist but NONE is a depth-chart starter — a pool from before is_starter existed", async () => {
    // Nothing else on a cron-less free instance would ever backfill
    // the flag; without this branch the quiz would stay on
    // third-stringers forever.
    await createTestNflAthlete({ isStarter: false });
    await createTestNflAthlete({ isStarter: false });

    await ensurePlayerPool();

    expect(await ingestRuns()).toBe(1);
  });

  it("does nothing when the pool has at least one starter", async () => {
    await createTestNflAthlete({ isStarter: true });
    await createTestNflAthlete({ isStarter: false });

    await ensurePlayerPool();

    expect(await ingestRuns()).toBe(0);
  });
});
