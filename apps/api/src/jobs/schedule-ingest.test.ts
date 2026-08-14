import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { game, jobRun, pick } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import * as errorTracking from "../lib/error-tracking.js";
import { MockSportsProvider, type CanonicalScheduleEntry } from "../lib/sports-provider.js";
import { runScheduleIngest } from "./schedule-ingest.js";

afterEach(() => {
  // vi.spyOn on a module namespace export doesn't reset itself between
  // tests — without this, a spy's call history from an earlier test
  // leaks into a later one's assertions.
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await truncateAllTables();
});

function scheduleEntry(overrides: Partial<CanonicalScheduleEntry> = {}): CanonicalScheduleEntry {
  return {
    externalId: "espn-1",
    sport: "nfl",
    startsAt: new Date("2026-09-14T17:00:00.000Z"),
    status: "scheduled",
    homeTeam: { externalId: "1", displayName: "Home Team" },
    awayTeam: { externalId: "2", displayName: "Away Team" },
    allowsDraw: false,
    ...overrides,
  };
}

describe("runScheduleIngest — idempotent upsert", () => {
  it("running 3x against identical data produces identical rows, not duplicates", async () => {
    const entry = scheduleEntry();
    const provider = new MockSportsProvider({ schedule: [entry] });

    await runScheduleIngest(provider);
    const [afterFirst] = await db.select().from(game).where(eq(game.externalId, entry.externalId));

    await runScheduleIngest(provider);
    await runScheduleIngest(provider);
    const allRows = await db.select().from(game).where(eq(game.externalId, entry.externalId));

    expect(allRows).toHaveLength(1);
    expect(allRows[0]!.id).toBe(afterFirst!.id);
    expect(allRows[0]!.createdAt).toEqual(afterFirst!.createdAt);
    expect(allRows[0]!.homeTeam).toBe("Home Team");
  });

  it("a changed start time propagates on re-ingest (flex scheduling)", async () => {
    const provider1 = new MockSportsProvider({ schedule: [scheduleEntry()] });
    await runScheduleIngest(provider1);

    const newTime = new Date("2026-09-15T01:00:00.000Z");
    const provider2 = new MockSportsProvider({ schedule: [scheduleEntry({ startsAt: newTime })] });
    await runScheduleIngest(provider2);

    const [row] = await db.select().from(game).where(eq(game.externalId, "espn-1"));
    expect(row!.startsAt).toEqual(newTime);
  });

  it("a name drift for the same team external ID is corrected on re-ingest", async () => {
    const provider1 = new MockSportsProvider({
      schedule: [scheduleEntry({ homeTeam: { externalId: "1", displayName: "Old Name" } })],
    });
    await runScheduleIngest(provider1);

    const provider2 = new MockSportsProvider({
      schedule: [scheduleEntry({ homeTeam: { externalId: "1", displayName: "New Name" } })],
    });
    await runScheduleIngest(provider2);

    const [row] = await db.select().from(game).where(eq(game.externalId, "espn-1"));
    expect(row!.homeTeam).toBe("New Name");
    expect(row!.homeTeamExternalId).toBe("1");
  });
});

describe("runScheduleIngest — never downgrades an already-final game", () => {
  it("re-scanning a game score-poll already finalized does not revert its status or touch its result", async () => {
    // Seed a game that's already final, with a result — exactly what
    // score-poll would have produced.
    const testGame = await createTestGame({
      externalId: "espn-final-1",
      sport: "nfl",
      homeTeam: "Home Team",
      awayTeam: "Away Team",
      status: "final",
      startsAt: new Date("2026-09-13T17:00:00.000Z"),
    });
    const { result } = await import("../db/schema.js");
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Home Team", source: "espn" });

    // schedule-ingest's regular lookback window re-scans it and (per
    // ESPN) computes it as final again — this is the realistic,
    // everyday case the lookback margin creates, not a contrived one.
    const provider = new MockSportsProvider({
      schedule: [
        scheduleEntry({
          externalId: "espn-final-1",
          status: "final",
          homeTeam: { externalId: "1", displayName: "Home Team" },
          awayTeam: { externalId: "2", displayName: "Away Team" },
        }),
      ],
    });

    await runScheduleIngest(provider);

    const [afterIngest] = await db.select().from(game).where(eq(game.externalId, "espn-final-1"));
    expect(afterIngest!.status).toBe("final");

    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.winningTeam).toBe("Home Team");
    expect(resultRows[0]!.revisionCount).toBe(0);
  });

  it("a brand-new scheduled game is written as scheduled, not clamped incorrectly", async () => {
    const provider = new MockSportsProvider({ schedule: [scheduleEntry({ status: "scheduled" })] });
    await runScheduleIngest(provider);
    const [row] = await db.select().from(game).where(eq(game.externalId, "espn-1"));
    expect(row!.status).toBe("scheduled");
  });

  it("a game schedule-ingest sees as final for the first time is written as in_progress, not final (only score-poll writes final)", async () => {
    const provider = new MockSportsProvider({ schedule: [scheduleEntry({ status: "final" })] });
    await runScheduleIngest(provider);
    const [row] = await db.select().from(game).where(eq(game.externalId, "espn-1"));
    expect(row!.status).toBe("in_progress");
  });
});

describe("runScheduleIngest — postponement recovery", () => {
  it("a postponed game is re-checked and gets its new date, preserving game.id and existing picks", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);

    const postponedGame = await createTestGame({
      externalId: "espn-postponed-1",
      sport: "nfl",
      homeTeam: "Home Team",
      awayTeam: "Away Team",
      status: "postponed",
      startsAt: new Date("2026-09-13T17:00:00.000Z"),
    });
    const existingPick = await createTestPick(member.id, postponedGame.id, { selectedTeam: "Home Team" });

    const provider = new MockSportsProvider({
      schedule: [
        scheduleEntry({
          externalId: "espn-postponed-1",
          status: "scheduled",
          startsAt: new Date("2026-09-20T17:00:00.000Z"), // rescheduled a week later
        }),
      ],
    });

    await runScheduleIngest(provider);

    const [row] = await db.select().from(game).where(eq(game.externalId, "espn-postponed-1"));
    expect(row!.id).toBe(postponedGame.id); // same internal game — picks carry over
    expect(row!.status).toBe("scheduled");
    expect(row!.startsAt).toEqual(new Date("2026-09-20T17:00:00.000Z"));

    const { pick } = await import("../db/schema.js");
    const [pickRow] = await db.select().from(pick).where(eq(pick.id, existingPick.id));
    expect(pickRow!.gameId).toBe(postponedGame.id);
  });

  it("re-checks a postponed game even though its original date is now outside the forward-looking window", async () => {
    await createTestGame({
      externalId: "espn-old-postponed",
      sport: "nfl",
      status: "postponed",
      startsAt: new Date("2020-01-01T17:00:00.000Z"), // years in the past, well outside any lookback
    });

    const fetchScheduleSpy = vi.fn<import("../lib/sports-provider.js").SportsProvider["fetchSchedule"]>(
      async () => [],
    );
    const provider: import("../lib/sports-provider.js").SportsProvider = {
      fetchSchedule: fetchScheduleSpy,
      fetchResults: async () => [],
    };

    await runScheduleIngest(provider);

    // At least one call should target the postponed game's own
    // (ancient) date specifically — not just the regular rolling window.
    const calledWithOldDate = fetchScheduleSpy.mock.calls.some(
      ([params]) => params.fromDate === "20200101" && params.toDate === "20200101",
    );
    expect(calledWithOldDate).toBe(true);
  });
});

describe("runScheduleIngest — empty-slate alerting", () => {
  it("calls captureMessage when zero games are found across every sport, but still succeeds", async () => {
    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");
    const provider = new MockSportsProvider({ schedule: [] });

    await runScheduleIngest(provider);

    expect(captureMessageSpy).toHaveBeenCalledWith(expect.stringContaining("zero games"), expect.anything());

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "schedule-ingest"));
    expect(run!.succeeded).toBe(true);
    expect(run!.itemCount).toBe(0);
  });

  it("does not alert when at least one game is found", async () => {
    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");
    const provider = new MockSportsProvider({ schedule: [scheduleEntry()] });

    await runScheduleIngest(provider);

    expect(captureMessageSpy).not.toHaveBeenCalled();
  });
});

describe("runScheduleIngest — job_run tracking", () => {
  it("records a failed run and rethrows when every sport's fetch throws (total outage)", async () => {
    const provider: import("../lib/sports-provider.js").SportsProvider = {
      fetchSchedule: async () => {
        throw new Error("ESPN unreachable");
      },
      fetchResults: async () => [],
    };

    await expect(runScheduleIngest(provider)).rejects.toThrow("all 11 sports failed to fetch");

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "schedule-ingest"));
    expect(run!.succeeded).toBe(false);
  });
});

describe("runScheduleIngest — one sport failing does not block the others", () => {
  it("one sport's fetch throwing (e.g. ESPN 404s an out-of-season scoreboard) still ingests every other sport, and the run succeeds", async () => {
    // Discovered live against the real ESPN API: NCAA men's basketball's
    // scoreboard 404s in August (out of season) instead of returning [].
    const provider: import("../lib/sports-provider.js").SportsProvider = {
      fetchSchedule: async ({ sport }) => {
        if (sport === "ncaamb") throw new Error("ESPN request failed: 404");
        return [scheduleEntry({ externalId: `espn-${sport}`, sport })];
      },
      fetchResults: async () => [],
    };

    await runScheduleIngest(provider);

    const nflRow = await db.select().from(game).where(eq(game.externalId, "espn-nfl"));
    expect(nflRow).toHaveLength(1);
    const ncaambRow = await db.select().from(game).where(eq(game.externalId, "espn-ncaamb"));
    expect(ncaambRow).toHaveLength(0);

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "schedule-ingest"));
    expect(run!.succeeded).toBe(true);
    expect(run!.itemCount).toBe(10); // every sport except the one that 404'd
  });

  it("does not fire the all-sports-zero alert when only some sports errored but others returned real games", async () => {
    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");
    const provider: import("../lib/sports-provider.js").SportsProvider = {
      fetchSchedule: async ({ sport }) => {
        if (sport === "ncaamb") throw new Error("ESPN request failed: 404");
        return [scheduleEntry({ externalId: `espn-${sport}`, sport })];
      },
      fetchResults: async () => [],
    };

    await runScheduleIngest(provider);

    expect(captureMessageSpy).not.toHaveBeenCalled();
  });
});

describe("runScheduleIngest — grading integration (JAC-37-42)", () => {
  it("voids ungraded picks for a game whose upsert just transitioned it to postponed", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({
      externalId: "espn-postponed-grade",
      sport: "nfl",
      status: "scheduled",
      startsAt: new Date("2026-09-13T17:00:00.000Z"),
    });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Home" });

    const provider = new MockSportsProvider({
      schedule: [scheduleEntry({ externalId: "espn-postponed-grade", status: "postponed" })],
    });
    await runScheduleIngest(provider);

    const [pickRow] = await db.select().from(pick).where(eq(pick.id, testPick.id));
    expect(pickRow!.outcome).toBe("void");
  });

  it("does not touch picks for games that stayed scheduled in the same upsert batch", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({
      externalId: "espn-still-scheduled",
      sport: "nfl",
      status: "scheduled",
      startsAt: new Date("2026-09-13T17:00:00.000Z"),
    });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Home" });

    const provider = new MockSportsProvider({
      schedule: [scheduleEntry({ externalId: "espn-still-scheduled", status: "scheduled" })],
    });
    await runScheduleIngest(provider);

    const [pickRow] = await db.select().from(pick).where(eq(pick.id, testPick.id));
    expect(pickRow!.outcome).toBeNull();
  });
});
