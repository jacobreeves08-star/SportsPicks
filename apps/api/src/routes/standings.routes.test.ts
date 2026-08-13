import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { pick, result } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestResultCorrection,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { createSession } from "../lib/session.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

async function tokenFor(userId: string) {
  const { accessToken } = await createSession(userId);
  return accessToken;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function gradePick(pickId: string, outcome: "win" | "loss" | "void", gradedAt: Date = new Date()): Promise<void> {
  await db.update(pick).set({ outcome, gradedAt }).where(eq(pick.id, pickId));
}

describe("GET /leagues/:leagueId/standings", () => {
  it("returns ranked standings with wins/losses/winPct/gamesParticipated and the caller's own member id", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const league = await createTestLeague(aliceUser.id, { timezone: "UTC", seasonStart: "2026-01-01" });
    const alice = await createTestLeagueMember(aliceUser.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ displayName: "Bob" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    const g1 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    const g2 = await createTestGame({ startsAt: new Date("2026-01-10T18:00:00Z") });
    await gradePick((await createTestPick(alice.id, g1.id)).id, "win");
    await gradePick((await createTestPick(alice.id, g2.id)).id, "win");
    await gradePick((await createTestPick(bob.id, g1.id)).id, "win");
    await gradePick((await createTestPick(bob.id, g2.id)).id, "loss");

    const token = await tokenFor(aliceUser.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/standings?timeframe=season`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.timeframe).toBe("season");
    expect(body.callerLeagueMemberId).toBe(alice.id);
    expect(body.standings).toHaveLength(2);
    expect(body.standings[0]).toMatchObject({
      leagueMemberId: alice.id,
      wins: 2,
      losses: 0,
      gamesParticipated: 2,
      winPct: 1,
      rank: 1,
    });
    expect(body.standings[1]).toMatchObject({ leagueMemberId: bob.id, wins: 1, losses: 1, winPct: 0.5, rank: 2 });
  });

  it("rankChange diffs against the prior day for timeframe=today", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const league = await createTestLeague(aliceUser.id, { timezone: "UTC" });
    const alice = await createTestLeagueMember(aliceUser.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ displayName: "Bob" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    // Yesterday: Bob wins, Alice loses -> Bob rank 1, Alice rank 2.
    const yesterdayGame = await createTestGame({ startsAt: new Date("2026-03-09T18:00:00Z") });
    await gradePick((await createTestPick(alice.id, yesterdayGame.id)).id, "loss");
    await gradePick((await createTestPick(bob.id, yesterdayGame.id)).id, "win");

    // Today: Alice wins, Bob loses -> Alice rank 1, Bob rank 2.
    const todayGame = await createTestGame({ startsAt: new Date("2026-03-10T18:00:00Z") });
    await gradePick((await createTestPick(alice.id, todayGame.id)).id, "win");
    await gradePick((await createTestPick(bob.id, todayGame.id)).id, "loss");

    const token = await tokenFor(aliceUser.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/standings?timeframe=today&date=2026-03-10`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const standingsByMember = new Map(
      (res.json().standings as Array<{ leagueMemberId: string; rank: number; rankChange: number | null }>).map((s) => [
        s.leagueMemberId,
        s,
      ]),
    );
    expect(standingsByMember.get(alice.id)).toMatchObject({ rank: 1, rankChange: 1 }); // 2nd -> 1st
    expect(standingsByMember.get(bob.id)).toMatchObject({ rank: 2, rankChange: -1 }); // 1st -> 2nd
  });

  it("rankChange is null for timeframe=season", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/standings?timeframe=season`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    for (const entry of res.json().standings as Array<{ rankChange: number | null }>) {
      expect(entry.rankChange).toBeNull();
    }
  });

  it("rejects a non-member", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const outsider = await createTestUser();

    const token = await tokenFor(outsider.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/standings`, headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/standings` });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /leagues/:leagueId/head-to-head", () => {
  it("only includes locked games, omitting future unlocked ones entirely", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const lockedGame = await createTestGame({
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date("2026-03-10T12:00:00Z"), // in the past relative to test's "now"
    });
    await createTestPick(member.id, lockedGame.id, { selectedTeam: "Bills" });

    const openGame = await createTestGame({
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date(Date.now() + 3600_000), // still open
    });
    void openGame;

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/head-to-head?date=2026-03-10`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const games = res.json().games;
    expect(games).toHaveLength(1);
    expect(games[0].gameId).toBe(lockedGame.id);
  });

  it("computes split (disagreement) and allWrong flags server-side", async () => {
    const ownerUser = await createTestUser({ displayName: "Owner" });
    const league = await createTestLeague(ownerUser.id, { timezone: "UTC" });
    const owner = await createTestLeagueMember(ownerUser.id, league.id, { role: "commissioner" });
    const otherUser = await createTestUser({ displayName: "Other" });
    const other = await createTestLeagueMember(otherUser.id, league.id);

    const splitGame = await createTestGame({
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date("2026-03-10T12:00:00Z"),
    });
    await db.insert(result).values({ gameId: splitGame.id, winningTeam: "Bills", source: "seed" });
    await createTestPick(owner.id, splitGame.id, { selectedTeam: "Bills" });
    await createTestPick(other.id, splitGame.id, { selectedTeam: "Jets" });

    const allWrongGame = await createTestGame({
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date("2026-03-10T14:00:00Z"),
    });
    await db.insert(result).values({ gameId: allWrongGame.id, winningTeam: "Chiefs", source: "seed" });
    await createTestPick(owner.id, allWrongGame.id, { selectedTeam: "Raiders" });
    await createTestPick(other.id, allWrongGame.id, { selectedTeam: "Raiders" });

    const token = await tokenFor(ownerUser.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/head-to-head?date=2026-03-10`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const games = res.json().games as Array<{ gameId: string; split: boolean; allWrong: boolean }>;
    const splitEntry = games.find((g) => g.gameId === splitGame.id)!;
    expect(splitEntry.split).toBe(true);
    expect(splitEntry.allWrong).toBe(false);
    const allWrongEntry = games.find((g) => g.gameId === allWrongGame.id)!;
    expect(allWrongEntry.split).toBe(false);
    expect(allWrongEntry.allWrong).toBe(true);
  });

  it("reports a null hit and null winningTeam for a locked game with no result yet", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const ungradedGame = await createTestGame({
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date("2026-03-10T12:00:00Z"),
    });
    await createTestPick(member.id, ungradedGame.id, { selectedTeam: "Bills" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/head-to-head?date=2026-03-10`,
      headers: auth(token),
    });

    const games = res.json().games;
    expect(games[0].winningTeam).toBeNull();
    expect(games[0].picks[0].hit).toBeNull();
  });
});

describe("POST /leagues/:leagueId/games/:gameId/correct-result", () => {
  it("the commissioner can correct a result, regrading picks and recording a manual correction", async () => {
    const commissionerUser = await createTestUser();
    const league = await createTestLeague(commissionerUser.id, { sports: ["nfl"] });
    const commissioner = await createTestLeagueMember(commissionerUser.id, league.id, { role: "commissioner" });
    const otherUser = await createTestUser();
    const other = await createTestLeagueMember(otherUser.id, league.id);

    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "seed" });
    const billsPick = await createTestPick(commissioner.id, testGame.id, { selectedTeam: "Bills" });
    const jetsPick = await createTestPick(other.id, testGame.id, { selectedTeam: "Jets" });
    await gradePick(billsPick.id, "win");
    await gradePick(jetsPick.id, "loss");

    const token = await tokenFor(commissionerUser.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${testGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Jets", reason: "Scoring error corrected by the league" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.correction).toMatchObject({
      oldWinningTeam: "Bills",
      newWinningTeam: "Jets",
      source: "manual",
      correctedByUserId: commissionerUser.id,
      correctedFromLeagueId: league.id,
      reason: "Scoring error corrected by the league",
    });
    const affectedByMember = new Map(
      (body.affectedMembers as Array<{ leagueMemberId: string; oldOutcome: string; newOutcome: string }>).map((a) => [
        a.leagueMemberId,
        a,
      ]),
    );
    expect(affectedByMember.get(commissioner.id)).toMatchObject({ oldOutcome: "win", newOutcome: "loss" });
    expect(affectedByMember.get(other.id)).toMatchObject({ oldOutcome: "loss", newOutcome: "win" });

    const [resultRow] = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRow!.winningTeam).toBe("Jets");
    const [billsPickRow] = await db.select().from(pick).where(eq(pick.id, billsPick.id));
    expect(billsPickRow!.outcome).toBe("loss");
  });

  it("rejects a non-commissioner member", async () => {
    const ownerUser = await createTestUser();
    const league = await createTestLeague(ownerUser.id, { sports: ["nfl"] });
    await createTestLeagueMember(ownerUser.id, league.id, { role: "commissioner" });
    const memberUser = await createTestUser();
    await createTestLeagueMember(memberUser.id, league.id);

    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "seed" });

    const token = await tokenFor(memberUser.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${testGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Jets", reason: "Trying anyway" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("404s when the game has no result yet", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${testGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Jets", reason: "No result exists" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESULT_NOT_FOUND");
  });

  it("400s for a winningTeam that isn't a participant", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "seed" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${testGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Cowboys", reason: "Not even playing" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a no-op correction matching the current result", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "seed" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${testGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Bills", reason: "Same as before" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NO_CHANGE");
  });

  it("404s for a game outside this league's sports", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const nbaGame = await createTestGame({ sport: "nba", homeTeam: "Lakers", awayTeam: "Celtics" });
    await db.insert(result).values({ gameId: nbaGame.id, winningTeam: "Lakers", source: "seed" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/games/${nbaGame.id}/correct-result`,
      headers: auth(token),
      payload: { winningTeam: "Celtics", reason: "Wrong sport for this league" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("GAME_NOT_FOUND");
  });
});

describe("GET /leagues/:leagueId/corrections", () => {
  it("is readable by a non-commissioner member and scoped to the league's sports", async () => {
    const ownerUser = await createTestUser();
    const league = await createTestLeague(ownerUser.id, { sports: ["nfl"] });
    await createTestLeagueMember(ownerUser.id, league.id, { role: "commissioner" });
    const memberUser = await createTestUser();
    await createTestLeagueMember(memberUser.id, league.id);

    const nflGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    const nflCorrection = await createTestResultCorrection(nflGame.id, {
      oldWinningTeam: "Bills",
      newWinningTeam: "Jets",
    });

    const nbaGame = await createTestGame({ sport: "nba", homeTeam: "Lakers", awayTeam: "Celtics" });
    await createTestResultCorrection(nbaGame.id, { oldWinningTeam: "Lakers", newWinningTeam: "Celtics" });

    const token = await tokenFor(memberUser.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/corrections`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(nflCorrection.id);
  });

  it("rejects a non-member", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const outsider = await createTestUser();

    const token = await tokenFor(outsider.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/corrections`, headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });
});
