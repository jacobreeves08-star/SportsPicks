import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { golfPick, tournamentEntry } from "../db/schema.js";
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
import { gradeGolfPicks, voidTournamentPicks } from "./golf-grading.js";

beforeEach(async () => {
  await truncateAllTables();
});

async function outcomeOf(golfPickId: string) {
  const [row] = await db.select().from(golfPick).where(eq(golfPick.id, golfPickId));
  return { outcome: row!.outcome, gradedAt: row!.gradedAt };
}

async function setupPick(golferPositions: (number | null)[], leagueOverrides: { golfTopN?: number } = {}) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, { golfTopN: leagueOverrides.golfTopN ?? 10 });
  const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
  const t = await createTestTournament();
  const gp = await createTestGolfPick(member.id, t.id);
  for (const position of golferPositions) {
    const entry = await createTestTournamentEntry(t.id, { position });
    await createTestGolfPickSelection(gp.id, entry.id);
  }
  return { owner, league, member, tournament: t, golfPick: gp };
}

describe("gradeGolfPicks", () => {
  it("grades a win when at least one selected golfer is within the league's top N", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([15, 3, 40], { golfTopN: 10 });
    await gradeGolfPicks(t.id, db);
    const { outcome, gradedAt } = await outcomeOf(gp.id);
    expect(outcome).toBe("win");
    expect(gradedAt).not.toBeNull();
  });

  it("grades a loss when none of the selected golfers are within top N", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([15, 22, 40], { golfTopN: 10 });
    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("loss");
  });

  it("a golfer with no position yet (null) never counts as a top-N finish", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([null, null], { golfTopN: 10 });
    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("loss");
  });

  it("respects the boundary — position exactly equal to golfTopN counts as a win", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([10], { golfTopN: 10 });
    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("win");
  });

  it("is re-runnable and overwrites a prior grade as the leaderboard changes (the live-grading requirement)", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([], { golfTopN: 10 });
    // No selections yet — simulate the leaderboard moving between polls
    // by inserting one now, since real usage grades AFTER each poll.
    const entry = await createTestTournamentEntry(t.id, { position: 20 });
    await createTestGolfPickSelection(gp.id, entry.id);

    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("loss");

    // The golfer moves inside the top 10 on the next poll.
    await db.update(tournamentEntry).set({ position: 5 }).where(eq(tournamentEntry.id, entry.id));
    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("win"); // flipped, unlike gradeFinalGame's grade-once behavior
  });

  it("uses each pick's OWN league's golf_top_n, not a global constant", async () => {
    const ownerA = await createTestUser();
    const leagueA = await createTestLeague(ownerA.id, { golfTopN: 5 });
    const memberA = await createTestLeagueMember(ownerA.id, leagueA.id, { role: "commissioner" });
    const ownerB = await createTestUser();
    const leagueB = await createTestLeague(ownerB.id, { golfTopN: 20 });
    const memberB = await createTestLeagueMember(ownerB.id, leagueB.id, { role: "commissioner" });

    const t = await createTestTournament();
    const entry = await createTestTournamentEntry(t.id, { position: 15 });

    const pickA = await createTestGolfPick(memberA.id, t.id);
    await createTestGolfPickSelection(pickA.id, entry.id);
    const pickB = await createTestGolfPick(memberB.id, t.id);
    await createTestGolfPickSelection(pickB.id, entry.id);

    await gradeGolfPicks(t.id, db);

    expect((await outcomeOf(pickA.id)).outcome).toBe("loss"); // 15 > top 5
    expect((await outcomeOf(pickB.id)).outcome).toBe("win"); // 15 <= top 20
  });

  it("never touches a voided pick", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([1], { golfTopN: 10 });
    await voidTournamentPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("void");

    await gradeGolfPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("void"); // untouched
  });
});

describe("voidTournamentPicks", () => {
  it("voids a pick rather than counting it as a loss", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([1], { golfTopN: 10 });
    await voidTournamentPicks(t.id, db);
    expect((await outcomeOf(gp.id)).outcome).toBe("void");
  });

  it("is idempotent", async () => {
    const { tournament: t, golfPick: gp } = await setupPick([1], { golfTopN: 10 });
    await voidTournamentPicks(t.id, db);
    const first = await outcomeOf(gp.id);
    await voidTournamentPicks(t.id, db);
    const second = await outcomeOf(gp.id);
    expect(second.gradedAt).toEqual(first.gradedAt);
  });
});
