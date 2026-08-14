import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { golfPick, golfPickSelection, tournament as tournamentTable } from "../db/schema.js";
import {
  createTestLeague,
  createTestLeagueMember,
  createTestTournament,
  createTestTournamentEntry,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { writeGolfPick } from "./golf-pick-write.js";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

beforeEach(async () => {
  await truncateAllTables();
});

async function setup(overrides: { golfPickCount?: number; tournamentStartsAt?: Date } = {}) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, {
    sports: ["golf"],
    golfPickCount: overrides.golfPickCount ?? 2,
  });
  const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
  const t = await createTestTournament({ startsAt: overrides.tournamentStartsAt ?? hoursFromNow(24) });
  const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });
  const golferB = await createTestTournamentEntry(t.id, { externalId: "golfer-b" });
  const golferC = await createTestTournamentEntry(t.id, { externalId: "golfer-c" });
  return { owner, league, member, tournament: t, golferA, golferB, golferC };
}

describe("writeGolfPick — happy path", () => {
  it("creates a golf pick with its selections", async () => {
    const { league, member, tournament } = await setup();

    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected accepted");
    expect(result.pick.golferExternalIds).toEqual(["golfer-a", "golfer-b"]);

    const [gp] = await db
      .select()
      .from(golfPick)
      .where(and(eq(golfPick.leagueMemberId, member.id), eq(golfPick.tournamentId, tournament.id)));
    expect(gp).toBeDefined();
    const selections = await db.select().from(golfPickSelection).where(eq(golfPickSelection.golfPickId, gp!.id));
    expect(selections).toHaveLength(2);
  });

  it("changing a pick replaces the selections, not appends", async () => {
    const { league, member, tournament } = await setup();

    await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    const second = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-b", "golfer-c"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });

    expect(second.accepted).toBe(true);
    const picks = await db
      .select()
      .from(golfPick)
      .where(and(eq(golfPick.leagueMemberId, member.id), eq(golfPick.tournamentId, tournament.id)));
    expect(picks).toHaveLength(1); // still one golf_pick row, not a duplicate

    const selections = await db.select().from(golfPickSelection).where(eq(golfPickSelection.golfPickId, picks[0]!.id));
    expect(selections).toHaveLength(2); // old selections replaced, not accumulated
  });

  it("two different members can pick the same golfer — unrestricted overlap (confirmed design)", async () => {
    const { league, member, tournament, golferA } = await setup({ golfPickCount: 1 });
    const otherOwner = await createTestUser();
    const otherMember = await createTestLeagueMember(otherOwner.id, league.id, { role: "member" });

    const resultA = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: [golferA.externalId],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    const resultB = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: otherMember.id,
      tournamentId: tournament.id,
      golferExternalIds: [golferA.externalId],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });

    expect(resultA.accepted).toBe(true);
    expect(resultB.accepted).toBe(true);
  });
});

describe("writeGolfPick — validation rejections", () => {
  it("rejects when the league hasn't opted into golf", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ startsAt: hoursFromNow(24) });

    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: t.id,
      golferExternalIds: [],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("GOLF_NOT_IN_LEAGUE_SPORTS");
  });

  it("rejects an unknown tournament", async () => {
    const { league, member } = await setup();
    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: "00000000-0000-0000-0000-000000000000",
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("TOURNAMENT_NOT_FOUND");
  });

  it("rejects a selection count that doesn't match golfPickCount", async () => {
    const { league, member, tournament } = await setup({ golfPickCount: 2 });
    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("WRONG_SELECTION_COUNT");
  });

  it("rejects a duplicate golfer within the same selection", async () => {
    const { league, member, tournament } = await setup({ golfPickCount: 2 });
    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-a"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("DUPLICATE_GOLFER_SELECTION");
  });

  it("rejects a golfer external ID not in this tournament's field", async () => {
    const { league, member, tournament } = await setup({ golfPickCount: 2 });
    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "not-in-the-field"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("UNKNOWN_GOLFER");
  });

  it("rejects a pick against a tournament that has already started (locked)", async () => {
    const { league, member, tournament } = await setup({ tournamentStartsAt: hoursFromNow(-1) });
    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("GOLF_PICK_LOCKED");
  });

  it("rejects a pick against a postponed tournament", async () => {
    const { league, member, tournament } = await setup();
    await db.update(tournamentTable).set({ status: "postponed" }).where(eq(tournamentTable.id, tournament.id));

    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("TOURNAMENT_POSTPONED");
  });

  it("rejects a pick against a canceled tournament", async () => {
    const { league, member, tournament } = await setup();
    await db.update(tournamentTable).set({ status: "canceled" }).where(eq(tournamentTable.id, tournament.id));

    const result = await writeGolfPick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      tournamentId: tournament.id,
      golferExternalIds: ["golfer-a", "golfer-b"],
      leagueSports: league.sports,
      golfPickCount: league.golfPickCount,
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejected");
    expect(result.reason).toBe("TOURNAMENT_CANCELED");
  });
});
