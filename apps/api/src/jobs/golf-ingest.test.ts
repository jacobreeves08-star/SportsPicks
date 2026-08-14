import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { golfPick, jobRun, tournament, tournamentEntry } from "../db/schema.js";
import {
  createTestGolfPick,
  createTestGolfPickSelection,
  createTestLeague,
  createTestLeagueMember,
  createTestTournament,
  createTestTournamentEntry,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { MockGolfProvider, type CanonicalTournamentSnapshot } from "../lib/golf-provider.js";
import { runGolfIngest } from "./golf-ingest.js";

beforeEach(async () => {
  await truncateAllTables();
});

function snapshot(overrides: Partial<CanonicalTournamentSnapshot["tournament"]> = {}, entries: CanonicalTournamentSnapshot["leaderboard"] = []): CanonicalTournamentSnapshot {
  return {
    tournament: {
      externalId: "espn-t1",
      name: "Test Open",
      startsAt: new Date("2026-08-13T04:00:00.000Z"),
      endsAt: new Date("2026-08-16T04:00:00.000Z"),
      status: "scheduled",
      ...overrides,
    },
    leaderboard: entries,
  };
}

describe("runGolfIngest — idempotent upsert", () => {
  it("running twice against identical data produces one tournament row, not duplicates", async () => {
    const provider = new MockGolfProvider({ tournaments: [snapshot()] });
    await runGolfIngest(provider);
    const [afterFirst] = await db.select().from(tournament).where(eq(tournament.externalId, "espn-t1"));

    await runGolfIngest(provider);
    const rows = await db.select().from(tournament).where(eq(tournament.externalId, "espn-t1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(afterFirst!.id);
  });

  it("writes the leaderboard as tournament_entry rows, upserting by (tournamentId, externalId) on re-ingest", async () => {
    const provider1 = new MockGolfProvider({
      tournaments: [
        snapshot({ status: "in_progress" }, [{ externalId: "g1", golferName: "Golfer One", position: 5 }]),
      ],
    });
    await runGolfIngest(provider1);

    const provider2 = new MockGolfProvider({
      tournaments: [
        snapshot({ status: "in_progress" }, [{ externalId: "g1", golferName: "Golfer One", position: 2 }]),
      ],
    });
    await runGolfIngest(provider2);

    const [t] = await db.select().from(tournament).where(eq(tournament.externalId, "espn-t1"));
    const entries = await db.select().from(tournamentEntry).where(eq(tournamentEntry.tournamentId, t!.id));
    expect(entries).toHaveLength(1); // upserted, not duplicated
    expect(entries[0]!.position).toBe(2);
  });

  it("never downgrades an already-final tournament's status", async () => {
    const provider1 = new MockGolfProvider({ tournaments: [snapshot({ status: "final" })] });
    await runGolfIngest(provider1);

    // A late/out-of-order response reports it as in_progress again.
    const provider2 = new MockGolfProvider({ tournaments: [snapshot({ status: "in_progress" })] });
    await runGolfIngest(provider2);

    const [row] = await db.select().from(tournament).where(eq(tournament.externalId, "espn-t1"));
    expect(row!.status).toBe("final");
  });
});

describe("runGolfIngest — grading integration", () => {
  it("grades picks for an in-progress tournament based on the just-written leaderboard", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { golfTopN: 10 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    // Seed the tournament + entry + pick BEFORE the ingest run, exactly
    // as a real pick-write would have happened before the tournament started.
    const t = await createTestTournament({ externalId: "espn-t1", status: "scheduled" });
    const entry = await createTestTournamentEntry(t.id, { externalId: "g1", position: null });
    const gp = await createTestGolfPick(member.id, t.id);
    await createTestGolfPickSelection(gp.id, entry.id);

    const provider = new MockGolfProvider({
      tournaments: [
        snapshot({ externalId: "espn-t1", status: "in_progress" }, [
          { externalId: "g1", golferName: "Golfer One", position: 3 },
        ]),
      ],
    });
    await runGolfIngest(provider);

    const [pickRow] = await db.select().from(golfPick).where(eq(golfPick.id, gp.id));
    expect(pickRow!.outcome).toBe("win");
  });

  it("does not grade a still-scheduled tournament's picks", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { golfTopN: 10 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ externalId: "espn-t1", status: "scheduled" });
    const entry = await createTestTournamentEntry(t.id, { externalId: "g1", position: null });
    const gp = await createTestGolfPick(member.id, t.id);
    await createTestGolfPickSelection(gp.id, entry.id);

    const provider = new MockGolfProvider({
      tournaments: [snapshot({ externalId: "espn-t1", status: "scheduled" }, [{ externalId: "g1", golferName: "Golfer One", position: null }])],
    });
    await runGolfIngest(provider);

    const [pickRow] = await db.select().from(golfPick).where(eq(golfPick.id, gp.id));
    expect(pickRow!.outcome).toBeNull();
  });

  it("voids picks when a tournament transitions to postponed", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { golfTopN: 10 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ externalId: "espn-t1", status: "in_progress" });
    const entry = await createTestTournamentEntry(t.id, { externalId: "g1", position: 5 });
    const gp = await createTestGolfPick(member.id, t.id);
    await createTestGolfPickSelection(gp.id, entry.id);

    const provider = new MockGolfProvider({
      tournaments: [snapshot({ externalId: "espn-t1", status: "postponed" }, [{ externalId: "g1", golferName: "Golfer One", position: 5 }])],
    });
    await runGolfIngest(provider);

    const [pickRow] = await db.select().from(golfPick).where(eq(golfPick.id, gp.id));
    expect(pickRow!.outcome).toBe("void");
  });

  it("re-grades a final tournament's picks against the final leaderboard (permanent, since no more polls follow)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { golfTopN: 1 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ externalId: "espn-t1", status: "in_progress" });
    const entry = await createTestTournamentEntry(t.id, { externalId: "g1", position: 2 });
    const gp = await createTestGolfPick(member.id, t.id);
    await createTestGolfPickSelection(gp.id, entry.id);

    const providerLive = new MockGolfProvider({
      tournaments: [snapshot({ externalId: "espn-t1", status: "in_progress" }, [{ externalId: "g1", golferName: "Golfer One", position: 2 }])],
    });
    await runGolfIngest(providerLive);
    expect((await db.select().from(golfPick).where(eq(golfPick.id, gp.id)))[0]!.outcome).toBe("loss");

    const providerFinal = new MockGolfProvider({
      tournaments: [snapshot({ externalId: "espn-t1", status: "final" }, [{ externalId: "g1", golferName: "Golfer One", position: 1 }])],
    });
    await runGolfIngest(providerFinal);
    expect((await db.select().from(golfPick).where(eq(golfPick.id, gp.id)))[0]!.outcome).toBe("win");
  });
});

describe("runGolfIngest — job_run tracking", () => {
  it("records itemCount as the number of tournaments processed", async () => {
    const provider = new MockGolfProvider({ tournaments: [snapshot()] });
    await runGolfIngest(provider);
    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "golf-ingest"));
    expect(run!.succeeded).toBe(true);
    expect(run!.itemCount).toBe(1);
  });

  it("records itemCount 0 (not an alert/failure) when no tournaments are in the window — a legitimate off-week", async () => {
    const provider = new MockGolfProvider({ tournaments: [] });
    await runGolfIngest(provider);
    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "golf-ingest"));
    expect(run!.succeeded).toBe(true);
    expect(run!.itemCount).toBe(0);
  });

  it("records a failed run and rethrows when the provider throws", async () => {
    const provider: import("../lib/golf-provider.js").GolfProvider = {
      fetchTournaments: async () => {
        throw new Error("ESPN unreachable");
      },
    };
    await expect(runGolfIngest(provider)).rejects.toThrow("ESPN unreachable");
    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "golf-ingest"));
    expect(run!.succeeded).toBe(false);
  });
});
