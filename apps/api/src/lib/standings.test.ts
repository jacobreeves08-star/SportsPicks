import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { golfPick, pick } from "../db/schema.js";
import {
  createTestGame,
  createTestGolfPick,
  createTestGolfPickSelection,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestTournament,
  createTestTournamentEntry,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { computeStandings } from "./standings.js";

beforeEach(async () => {
  await truncateAllTables();
});

async function gradePick(pickId: string, outcome: "win" | "loss" | "void", gradedAt: Date = new Date()): Promise<void> {
  await db.update(pick).set({ outcome, gradedAt }).where(eq(pick.id, pickId));
}

async function gradeGolfPick(golfPickId: string, outcome: "win" | "loss" | "void", gradedAt: Date = new Date()): Promise<void> {
  await db.update(golfPick).set({ outcome, gradedAt }).where(eq(golfPick.id, golfPickId));
}

/** Creates a golf_pick with one selection and grades it in one step —
 * the selection itself is never read by standings (only outcome/tournament
 * matter), so a single throwaway entry is enough for these tests. */
async function seedGradedGolfPick(
  memberId: string,
  tournamentId: string,
  outcome: "win" | "loss" | "void",
  gradedAt: Date = new Date(),
) {
  const gp = await createTestGolfPick(memberId, tournamentId);
  const entry = await createTestTournamentEntry(tournamentId);
  await createTestGolfPickSelection(gp.id, entry.id);
  await gradeGolfPick(gp.id, outcome, gradedAt);
  return gp;
}

describe("computeStandings — base wins/losses/winPct/rank (hand-calculated, JAC-37-42)", () => {
  it("matches a hand-calculated record for a seeded league", async () => {
    const owner = await createTestUser({ displayName: "Alice" });
    const league = await createTestLeague(owner.id, { timezone: "UTC", seasonStart: "2026-01-01" });
    const alice = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ displayName: "Bob" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);
    const carolUser = await createTestUser({ displayName: "Carol" });
    const carol = await createTestLeagueMember(carolUser.id, league.id);

    // Alice: 3-1 (75%). Bob: 2-2 (50%). Carol: 0 picks (0%).
    const games = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        createTestGame({ externalId: `hand-calc-${i}`, startsAt: new Date("2026-01-10T18:00:00Z") }),
      ),
    );

    const alicePicks = await Promise.all(games.map((g) => createTestPick(alice.id, g.id)));
    await gradePick(alicePicks[0]!.id, "win");
    await gradePick(alicePicks[1]!.id, "win");
    await gradePick(alicePicks[2]!.id, "win");
    await gradePick(alicePicks[3]!.id, "loss");

    const bobPicks = await Promise.all(games.map((g) => createTestPick(bob.id, g.id)));
    await gradePick(bobPicks[0]!.id, "win");
    await gradePick(bobPicks[1]!.id, "win");
    await gradePick(bobPicks[2]!.id, "loss");
    await gradePick(bobPicks[3]!.id, "loss");

    const standings = await computeStandings(league.id, "season", "2026-06-01");

    const byMember = new Map(standings.map((s) => [s.leagueMemberId, s]));
    expect(byMember.get(alice.id)).toMatchObject({ wins: 3, losses: 1, gamesParticipated: 4, winPct: 0.75, rank: 1 });
    expect(byMember.get(bob.id)).toMatchObject({ wins: 2, losses: 2, gamesParticipated: 4, winPct: 0.5, rank: 2 });
    expect(byMember.get(carol.id)).toMatchObject({ wins: 0, losses: 0, gamesParticipated: 0, winPct: 0, rank: 3 });
    expect(standings).toHaveLength(3);
  });

  it("excludes void picks from wins/losses/gamesParticipated entirely", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const wonGame = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const voidedGame = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });

    const wonPick = await createTestPick(member.id, wonGame.id);
    await gradePick(wonPick.id, "win");
    const voidedPick = await createTestPick(member.id, voidedGame.id);
    await gradePick(voidedPick.id, "void");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]).toMatchObject({ wins: 1, losses: 0, gamesParticipated: 1, winPct: 1 });
  });

  it("excludes members who have left the league", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const leftUser = await createTestUser();
    await createTestLeagueMember(leftUser.id, league.id, { leftAt: new Date() });

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings).toHaveLength(1);
  });

  it("returns an empty array for a league with no active members", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { leftAt: new Date() });

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings).toEqual([]);
  });
});

describe("computeStandings — timeframe filtering", () => {
  it("'today' includes only games starting within that UTC day", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id);

    const insideGame = await createTestGame({ startsAt: new Date("2026-03-10T12:00:00Z") });
    const beforeGame = await createTestGame({ startsAt: new Date("2026-03-09T23:59:59Z") });
    const atExclusiveEndGame = await createTestGame({ startsAt: new Date("2026-03-11T00:00:00Z") });

    await gradePick((await createTestPick(member.id, insideGame.id)).id, "win");
    await gradePick((await createTestPick(member.id, beforeGame.id)).id, "win");
    await gradePick((await createTestPick(member.id, atExclusiveEndGame.id)).id, "win");

    const standings = await computeStandings(league.id, "today", "2026-03-10");
    expect(standings[0]).toMatchObject({ wins: 1, gamesParticipated: 1 });
  });

  it("'week' includes only games within the Tuesday-Monday week", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id);

    // 2026-03-10 is a Tuesday; week runs through 2026-03-16 (Monday).
    const insideGame = await createTestGame({ startsAt: new Date("2026-03-15T12:00:00Z") }); // Sunday
    const outsideGame = await createTestGame({ startsAt: new Date("2026-03-17T12:00:00Z") }); // next Tuesday

    await gradePick((await createTestPick(member.id, insideGame.id)).id, "win");
    await gradePick((await createTestPick(member.id, outsideGame.id)).id, "win");

    const standings = await computeStandings(league.id, "week", "2026-03-10");
    expect(standings[0]).toMatchObject({ wins: 1, gamesParticipated: 1 });
  });

  it("'season' excludes games before the league's season start but has no upper bound", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC", seasonStart: "2026-01-01" });
    const member = await createTestLeagueMember(owner.id, league.id);

    const beforeSeasonGame = await createTestGame({ startsAt: new Date("2025-12-31T12:00:00Z") });
    const farFutureGame = await createTestGame({ startsAt: new Date("2026-12-25T12:00:00Z") });

    await gradePick((await createTestPick(member.id, beforeSeasonGame.id)).id, "win");
    await gradePick((await createTestPick(member.id, farFutureGame.id)).id, "win");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]).toMatchObject({ wins: 1, gamesParticipated: 1 });
  });
});

describe("computeStandings — tiebreaker chain (JAC-37-42, confirmed with user: full deterministic chain)", () => {
  it("level 2: resolves a win%-tie via head-to-head on commonly-picked games", async () => {
    const owner = await createTestUser({ displayName: "A-Member" });
    const league = await createTestLeague(owner.id);
    const memberA = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const userB = await createTestUser({ displayName: "B-Member" });
    const memberB = await createTestLeagueMember(userB.id, league.id);

    const g1 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") }); // common
    const g2 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") }); // common
    const g3 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") }); // A only
    const g4 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") }); // B only

    // A: right on both common games, wrong on its own extra game -> 2W-1L (66.7%).
    await gradePick((await createTestPick(memberA.id, g1.id)).id, "win");
    await gradePick((await createTestPick(memberA.id, g2.id)).id, "win");
    await gradePick((await createTestPick(memberA.id, g3.id)).id, "loss");

    // B: wrong on g1, right on g2, right on its own extra game -> 2W-1L (66.7%), tied with A overall.
    await gradePick((await createTestPick(memberB.id, g1.id)).id, "loss");
    await gradePick((await createTestPick(memberB.id, g2.id)).id, "win");
    await gradePick((await createTestPick(memberB.id, g4.id)).id, "win");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]!.winPct).toBeCloseTo(standings[1]!.winPct, 10); // genuinely tied overall
    // A got both commonly-picked games right (h2h=2); B got only one (h2h=1) -> A ranks first.
    expect(standings[0]!.leagueMemberId).toBe(memberA.id);
    expect(standings[0]!.rank).toBe(1);
    expect(standings[1]!.leagueMemberId).toBe(memberB.id);
    expect(standings[1]!.rank).toBe(2);
  });

  it("level 3: head-to-head also tied -> resolves by most recent correct pick", async () => {
    const owner = await createTestUser({ displayName: "C-Member" });
    const league = await createTestLeague(owner.id);
    const memberC = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const userD = await createTestUser({ displayName: "D-Member" });
    const memberD = await createTestLeagueMember(userD.id, league.id);

    // Both pick the SAME single game and both get it right -> identical
    // win% (100%) and identical head-to-head (both 1-for-1 on their one
    // shared game), so only recency can break the tie.
    const g1 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const cPick = await createTestPick(memberC.id, g1.id);
    const dPick = await createTestPick(memberD.id, g1.id);
    await gradePick(cPick.id, "win", new Date("2026-01-10T20:00:00Z")); // more recent
    await gradePick(dPick.id, "win", new Date("2026-01-10T19:00:00Z")); // older

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]!.leagueMemberId).toBe(memberC.id);
    expect(standings[1]!.leagueMemberId).toBe(memberD.id);
  });

  it("level 4: recency also tied -> resolves alphabetically by display name", async () => {
    const zoeUser = await createTestUser({ displayName: "Zoe" });
    const league = await createTestLeague(zoeUser.id);
    const zoe = await createTestLeagueMember(zoeUser.id, league.id, { role: "commissioner" });
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const alice = await createTestLeagueMember(aliceUser.id, league.id);

    // No commonly-picked games at all (h2h stays 0-0), and an identical
    // explicit gradedAt forces an exact recency tie too.
    const g1 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const g2 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const sameInstant = new Date("2026-01-10T20:00:00Z");
    await gradePick((await createTestPick(zoe.id, g1.id)).id, "win", sameInstant);
    await gradePick((await createTestPick(alice.id, g2.id)).id, "win", sameInstant);

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]!.leagueMemberId).toBe(alice.id); // "Alice" < "Zoe"
    expect(standings[1]!.leagueMemberId).toBe(zoe.id);
  });
});

describe("computeStandings — golf integration (JAC-56)", () => {
  it("merges golf wins/losses into the same member's overall record as game picks", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC", seasonStart: "2026-01-01" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const game = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    await gradePick((await createTestPick(member.id, game.id)).id, "win");

    const tournament = await createTestTournament({
      startsAt: new Date("2026-01-10T13:00:00Z"),
      endsAt: new Date("2026-01-13T22:00:00Z"),
    });
    await seedGradedGolfPick(member.id, tournament.id, "win");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]).toMatchObject({ wins: 2, losses: 0, gamesParticipated: 2, winPct: 1 });
  });

  it("credits a golf pick's outcome on the day the tournament ENDS, not the day it starts", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    // Starts Jan 9 (outside the Jan-10 'today' window), ends Jan 10
    // (inside it) — a real multi-day tournament spanning a day boundary.
    const tournament = await createTestTournament({
      startsAt: new Date("2026-01-09T13:00:00Z"),
      endsAt: new Date("2026-01-10T12:00:00Z"),
    });
    await seedGradedGolfPick(member.id, tournament.id, "win");

    const onEndDay = await computeStandings(league.id, "today", "2026-01-10");
    expect(onEndDay[0]).toMatchObject({ wins: 1, gamesParticipated: 1 });

    const onStartDay = await computeStandings(league.id, "today", "2026-01-09");
    expect(onStartDay[0]).toMatchObject({ wins: 0, gamesParticipated: 0 });
  });

  it("excludes voided golf picks from wins/losses/gamesParticipated entirely", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { seasonStart: "2026-01-01" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const tournament = await createTestTournament({
      startsAt: new Date("2026-01-10T13:00:00Z"),
      endsAt: new Date("2026-01-13T22:00:00Z"),
    });
    await seedGradedGolfPick(member.id, tournament.id, "void");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]).toMatchObject({ wins: 0, losses: 0, gamesParticipated: 0 });
  });

  it("an ungraded golf pick (tournament hasn't started/finished yet) contributes nothing", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { seasonStart: "2026-01-01" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const tournament = await createTestTournament({
      startsAt: new Date("2026-01-10T13:00:00Z"),
      endsAt: new Date("2026-01-13T22:00:00Z"),
    });
    const gp = await createTestGolfPick(member.id, tournament.id);
    const entry = await createTestTournamentEntry(tournament.id);
    await createTestGolfPickSelection(gp.id, entry.id);
    // Never graded — outcome stays null.

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]).toMatchObject({ wins: 0, losses: 0, gamesParticipated: 0 });
  });

  it("resolves a win%-tie via head-to-head on a commonly-picked TOURNAMENT, same mechanism as a commonly-picked game", async () => {
    const owner = await createTestUser({ displayName: "A-Member" });
    const league = await createTestLeague(owner.id);
    const memberA = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const userB = await createTestUser({ displayName: "B-Member" });
    const memberB = await createTestLeagueMember(userB.id, league.id);

    const tournament = await createTestTournament({
      startsAt: new Date("2026-01-10T13:00:00Z"),
      endsAt: new Date("2026-01-13T22:00:00Z"),
    });

    // Both members pick the SAME tournament: A wins it, B loses it. Each
    // also picks its OWN (not commonly-picked) game with the opposite
    // outcome, so both land at exactly 1W-1L — a genuine overall tie
    // that only the shared tournament can break.
    const gA = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const gB = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    await gradePick((await createTestPick(memberA.id, gA.id)).id, "loss");
    await gradePick((await createTestPick(memberB.id, gB.id)).id, "win");
    await seedGradedGolfPick(memberA.id, tournament.id, "win");
    await seedGradedGolfPick(memberB.id, tournament.id, "loss");

    const standings = await computeStandings(league.id, "season", "2026-06-01");
    expect(standings[0]!.winPct).toBeCloseTo(standings[1]!.winPct, 10); // tied overall (1-1 each)
    // A won the commonly-picked tournament, B lost it -> A ranks first.
    expect(standings[0]!.leagueMemberId).toBe(memberA.id);
    expect(standings[1]!.leagueMemberId).toBe(memberB.id);
  });
});
