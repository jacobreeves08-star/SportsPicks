import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { jobRun, nflAthlete } from "../db/schema.js";
import { truncateAllTables } from "../db/test-helpers.js";
import { MockNflAthleteProvider, type CanonicalNflAthlete } from "../lib/nfl-athlete-provider.js";
import { runNflAthleteIngest } from "./nfl-athlete-ingest.js";

beforeEach(async () => {
  await truncateAllTables();
});

function athlete(overrides: Partial<CanonicalNflAthlete> = {}): CanonicalNflAthlete {
  return {
    externalId: "espn-1",
    displayName: "Patrick Test",
    positionAbbreviation: "QB",
    jersey: "15",
    headshotUrl: "https://example.test/headshot.png",
    teamExternalId: "12",
    teamDisplayName: "Test Chiefs",
    collegeName: "Texas Tech",
    collegeExternalId: "2641",
    collegeLogoUrl: "https://example.test/logo.png",
    rosterStatus: "active",
    experienceYears: 8,
    ...overrides,
  };
}

describe("runNflAthleteIngest", () => {
  it("writes the player pool", async () => {
    await runNflAthleteIngest(new MockNflAthleteProvider([athlete(), athlete({ externalId: "espn-2" })]));

    const rows = await db.select().from(nflAthlete);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      displayName: "Patrick Test",
      collegeName: "Texas Tech",
      positionAbbreviation: "QB",
      rosterStatus: "active",
    });
  });

  it("is idempotent — re-running updates in place instead of duplicating", async () => {
    const provider = new MockNflAthleteProvider([athlete()]);

    await runNflAthleteIngest(provider);
    await runNflAthleteIngest(provider);

    expect(await db.select().from(nflAthlete)).toHaveLength(1);
  });

  it("refreshes a changed roster status and team on re-ingest", async () => {
    await runNflAthleteIngest(new MockNflAthleteProvider([athlete()]));
    await runNflAthleteIngest(
      new MockNflAthleteProvider([
        athlete({ rosterStatus: "injured_reserve", teamDisplayName: "Test Broncos", jersey: "3" }),
      ]),
    );

    const [row] = await db.select().from(nflAthlete).where(eq(nflAthlete.externalId, "espn-1"));
    expect(row).toMatchObject({
      rosterStatus: "injured_reserve",
      teamDisplayName: "Test Broncos",
      jersey: "3",
    });
  });

  it("never deletes an athlete the provider stopped returning — past puzzles reference them", async () => {
    await runNflAthleteIngest(new MockNflAthleteProvider([athlete(), athlete({ externalId: "espn-retired" })]));

    // Next week: the retired player is gone from ESPN's response.
    await runNflAthleteIngest(new MockNflAthleteProvider([athlete()]));

    const rows = await db.select().from(nflAthlete);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["espn-1", "espn-retired"]);
  });

  it("records a successful job run with the item count", async () => {
    await runNflAthleteIngest(new MockNflAthleteProvider([athlete(), athlete({ externalId: "espn-2" })]));

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "nfl-athlete-ingest"));
    expect(run).toMatchObject({ succeeded: true, itemCount: 2, errorMessage: null });
  });

  it("records an empty run as SUCCEEDED — the existing pool is untouched and still playable", async () => {
    await runNflAthleteIngest(new MockNflAthleteProvider([]));

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "nfl-athlete-ingest"));
    expect(run).toMatchObject({ succeeded: true, itemCount: 0 });
  });

  it("records the failure and rethrows when the provider blows up", async () => {
    const exploding = {
      fetchAthletes: async () => {
        throw new Error("ESPN is down");
      },
    };

    await expect(runNflAthleteIngest(exploding)).rejects.toThrow("ESPN is down");

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "nfl-athlete-ingest"));
    expect(run).toMatchObject({ succeeded: false, errorMessage: "ESPN is down" });
  });
});
