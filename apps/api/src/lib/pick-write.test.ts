import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { pick, pickAuditLog } from "../db/schema.js";
import { createTestGame, createTestLeague, createTestLeagueMember, createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { writePick } from "./pick-write.js";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

beforeEach(async () => {
  await truncateAllTables();
});

async function setup(gameOverrides: Parameters<typeof createTestGame>[0] = {}) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, { sports: ["nfl"] });
  const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
  const game = await createTestGame({
    sport: "nfl",
    homeTeam: "Bills",
    awayTeam: "Jets",
    startsAt: hoursFromNow(1),
    ...gameOverrides,
  });
  return { owner, league, member, game };
}

describe("writePick — happy path", () => {
  it("creates a pick and logs a 'create' audit row", async () => {
    const { member, game, league } = await setup();

    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected accepted");
    expect(result.pick.selectedTeam).toBe("Bills");

    const auditRows = await db
      .select()
      .from(pickAuditLog)
      .where(and(eq(pickAuditLog.leagueMemberId, member.id), eq(pickAuditLog.gameId, game.id)));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe("create");
  });

  it("changing an existing pick logs a 'change' audit row, not a duplicate pick", async () => {
    const { member, game, league } = await setup();

    await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    const second = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Jets",
      leagueSports: league.sports,
    });

    expect(second.accepted).toBe(true);
    const picks = await db.select().from(pick).where(and(eq(pick.leagueMemberId, member.id), eq(pick.gameId, game.id)));
    expect(picks).toHaveLength(1);
    expect(picks[0]!.selectedTeam).toBe("Jets");

    const auditRows = await db
      .select()
      .from(pickAuditLog)
      .where(and(eq(pickAuditLog.leagueMemberId, member.id), eq(pickAuditLog.gameId, game.id)));
    expect(auditRows).toHaveLength(2);
    expect(auditRows.map((r) => r.action)).toEqual(["create", "change"]);
  });

  it("accepts the 'DRAW' sentinel when the game allows it", async () => {
    const { member, league } = await setup();
    const soccerGame = await createTestGame({
      sport: "epl",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      allowsDraw: true,
      startsAt: hoursFromNow(1),
    });
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: soccerGame.id,
      selectedTeam: "DRAW",
      leagueSports: [...league.sports, "epl"],
    });
    expect(result.accepted).toBe(true);
  });
});

describe("writePick — pre-validated rejections (no SQL exception, no audit row)", () => {
  it("rejects a game not found", async () => {
    const { member, league } = await setup();
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: "00000000-0000-0000-0000-000000000099",
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "GAME_NOT_FOUND" });
  });

  it("rejects a game whose sport isn't in the league", async () => {
    const { member, league } = await setup();
    const mlbGame = await createTestGame({ sport: "mlb", homeTeam: "Yankees", awayTeam: "Red Sox", startsAt: hoursFromNow(1) });
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: mlbGame.id,
      selectedTeam: "Yankees",
      leagueSports: ["nfl"], // league only covers nfl
    });
    expect(result).toMatchObject({ accepted: false, reason: "GAME_NOT_IN_LEAGUE_SPORTS" });
  });

  it("rejects a canceled game", async () => {
    const { member, league, game } = await setup({ status: "canceled" });
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "GAME_CANCELED" });
  });

  it("rejects a postponed game", async () => {
    const { member, league, game } = await setup({ status: "postponed" });
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "GAME_POSTPONED" });
  });

  it("rejects a team name that isn't playing in the game — the exact case that would otherwise trip the DB trigger", async () => {
    const { member, league, game } = await setup();
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Cowboys",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "INVALID_TEAM_SELECTION" });

    // Confirm no pick or audit row was written at all.
    const picks = await db.select().from(pick).where(eq(pick.gameId, game.id));
    expect(picks).toHaveLength(0);
    const auditRows = await db.select().from(pickAuditLog).where(eq(pickAuditLog.gameId, game.id));
    expect(auditRows).toHaveLength(0);
  });

  it("rejects 'DRAW' for a game that doesn't allow it", async () => {
    const { member, league, game } = await setup(); // nfl, allowsDraw defaults false
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "DRAW",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "INVALID_TEAM_SELECTION" });
  });
});

describe("writePick — lock enforcement", () => {
  it("rejects a game that has already started (fast path, pre-check)", async () => {
    const { member, league, game } = await setup({ startsAt: new Date(Date.now() - 60_000) });
    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "PICK_LOCKED" });
  });

  it("re-reads the CURRENT start time, not a stale one — a game rescheduled earlier locks at the new time", async () => {
    const { member, league, game } = await setup({ startsAt: hoursFromNow(2) });

    // Reschedule to the past directly at the DB level, simulating
    // schedule-ingest moving the game earlier.
    const { game: gameTable } = await import("../db/schema.js");
    await db.update(gameTable).set({ startsAt: new Date(Date.now() - 1000) }).where(eq(gameTable.id, game.id));

    const result = await writePick(db, {
      leagueId: league.id,
      leagueMemberId: member.id,
      gameId: game.id,
      selectedTeam: "Bills",
      leagueSports: league.sports,
    });
    expect(result).toMatchObject({ accepted: false, reason: "PICK_LOCKED" });
  });
});
