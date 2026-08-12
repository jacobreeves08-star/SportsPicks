import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { game as gameTable, pick, pickAuditLog, result } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { createSession } from "../lib/session.js";

/**
 * Tests for the new JAC-31-36 endpoints (batch pick write, slate,
 * audit trail) — kept in a separate file from leagues.routes.test.ts
 * purely for size; the routes themselves live in leagues.routes.ts
 * alongside the existing single-pick PUT route (whose own lock-
 * enforcement tests stay colocated there).
 */

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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

describe("POST /leagues/:leagueId/members/:memberId/picks/batch", () => {
  it("a batch of 5 where 2 have already started resolves to 3 accepted, 2 rejected, with per-game detail (JAC-33)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const open1 = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const open2 = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(60) });
    const open3 = await createTestGame({ homeTeam: "Packers", awayTeam: "Bears", startsAt: minutesFromNow(60) });
    const started1 = await createTestGame({ homeTeam: "Eagles", awayTeam: "Giants", startsAt: minutesFromNow(-5) });
    const started2 = await createTestGame({ homeTeam: "49ers", awayTeam: "Rams", startsAt: minutesFromNow(-10) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: open1.id, selectedTeam: "Bills" },
          { gameId: open2.id, selectedTeam: "Chiefs" },
          { gameId: started1.id, selectedTeam: "Eagles" },
          { gameId: open3.id, selectedTeam: "Packers" },
          { gameId: started2.id, selectedTeam: "49ers" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results).toHaveLength(5);

    const byGame = new Map(results.map((r: { gameId: string }) => [r.gameId, r]));
    expect(byGame.get(open1.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Bills" } });
    expect(byGame.get(open2.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Chiefs" } });
    expect(byGame.get(open3.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Packers" } });
    expect(byGame.get(started1.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });
    expect(byGame.get(started2.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });

    const accepted = results.filter((r: { status: string }) => r.status === "accepted");
    const rejected = results.filter((r: { status: string }) => r.status === "rejected");
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    // The 3 accepted picks are actually persisted; the 2 rejected ones are not.
    const persistedPicks = await db.select().from(pick).where(eq(pick.leagueMemberId, member.id));
    expect(persistedPicks).toHaveLength(3);
  });

  it("a game moved EARLIER mid-batch-preparation, picked after the new start time, is rejected within the batch too", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const stillOpen = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const movedGame = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(60) });

    // Reschedule movedGame earlier, into the past, before the batch is submitted.
    await db.update(gameTable).set({ startsAt: minutesFromNow(-1) }).where(eq(gameTable.id, movedGame.id));

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: stillOpen.id, selectedTeam: "Bills" },
          { gameId: movedGame.id, selectedTeam: "Chiefs" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    const byGame = new Map(results.map((r: { gameId: string }) => [r.gameId, r]));
    expect(byGame.get(stillOpen.id)).toMatchObject({ status: "accepted" });
    expect(byGame.get(movedGame.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });
  });

  it("rejecting one game does not affect the audit log of accepted games in the same batch", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const open = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const started = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(-5) });

    const token = await tokenFor(owner.id);
    await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: open.id, selectedTeam: "Bills" },
          { gameId: started.id, selectedTeam: "Chiefs" },
        ],
      },
    });

    const auditRows = await db.select().from(pickAuditLog).where(eq(pickAuditLog.leagueMemberId, member.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.gameId).toBe(open.id);
    expect(auditRows[0]!.action).toBe("create");
  });

  it("a member cannot batch-write picks as another member — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id, { role: "member" });
    const memberB = await createTestLeagueMember(userB.id, league.id, { role: "member" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${memberB.id}/picks/batch`,
      headers: auth(tokenA),
      payload: { picks: [{ gameId: g.id, selectedTeam: "Bills" }] },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /leagues/:leagueId/slate", () => {
  it("filters to the league's sports and to the given date, computed in the league's timezone", async () => {
    const owner = await createTestUser();
    // America/Chicago is UTC-6 in January (CST) — 2026-01-15 00:00
    // America/Chicago is 2026-01-15T06:00:00Z.
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "America/Chicago" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const onDateEarly = await createTestGame({
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date("2026-01-15T06:00:00.000Z"), // exactly midnight local — IN range
    });
    const onDateLate = await createTestGame({
      sport: "nfl",
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date("2026-01-16T05:59:59.999Z"), // 1ms before next local midnight — IN range
    });
    const justBefore = await createTestGame({
      sport: "nfl",
      homeTeam: "Too", // 1ms before local midnight — the PREVIOUS local day
      awayTeam: "Early",
      startsAt: new Date("2026-01-15T05:59:59.999Z"),
    });
    const justAfter = await createTestGame({
      sport: "nfl",
      homeTeam: "Too",
      awayTeam: "Late",
      startsAt: new Date("2026-01-16T06:00:00.000Z"), // exactly next local midnight — the NEXT local day
    });
    const wrongSport = await createTestGame({
      sport: "mlb",
      homeTeam: "Yankees",
      awayTeam: "Red Sox",
      startsAt: new Date("2026-01-15T18:00:00.000Z"),
    });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${league.id}/slate?date=2026-01-15`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe("2026-01-15");
    const gameIds = body.games.map((g: { gameId: string }) => g.gameId);
    expect(gameIds.sort()).toEqual([onDateEarly.id, onDateLate.id].sort());
    expect(gameIds).not.toContain(justBefore.id);
    expect(gameIds).not.toContain(justAfter.id);
    expect(gameIds).not.toContain(wrongSport.id);
    void member;
  });

  it("defaults to today in the league's timezone when date is omitted", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    await createTestGame({ sport: "nfl", startsAt: new Date() });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/slate`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(res.json().date).toBe(today);
  });

  it("computes all five pickState values correctly", async () => {
    // Two separate fixed, hardcoded dates rather than anything relative
    // to real wall-clock "now": a comfortably-past date for the three
    // already-started games and a comfortably-future date for the two
    // still-open games. Anchoring "open" games to "now + 1 hour" would
    // make this test's pass/fail depend on what time of day it happens
    // to run relative to a UTC day boundary — exactly the kind of
    // flakiness this suite otherwise goes out of its way to avoid.
    const PAST_DATE = "2020-01-15";
    const FUTURE_DATE = "2099-01-15";

    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const unpickedGame = await createTestGame({ sport: "nfl", homeTeam: "A1", awayTeam: "A2", startsAt: new Date(`${FUTURE_DATE}T12:00:00.000Z`) });
    const pickedOpenGame = await createTestGame({ sport: "nfl", homeTeam: "B1", awayTeam: "B2", startsAt: new Date(`${FUTURE_DATE}T13:00:00.000Z`) });
    await createTestPick(member.id, pickedOpenGame.id, { selectedTeam: "B1" });

    const lockedNoResultGame = await createTestGame({ sport: "nfl", homeTeam: "C1", awayTeam: "C2", startsAt: new Date(`${PAST_DATE}T12:00:00.000Z`), status: "in_progress" });
    await createTestPick(member.id, lockedNoResultGame.id, { selectedTeam: "C1" });

    const hitGame = await createTestGame({ sport: "nfl", homeTeam: "D1", awayTeam: "D2", startsAt: new Date(`${PAST_DATE}T13:00:00.000Z`), status: "final" });
    await createTestPick(member.id, hitGame.id, { selectedTeam: "D1" });
    await db.insert(result).values({ gameId: hitGame.id, winningTeam: "D1", source: "seed" });

    const missGame = await createTestGame({ sport: "nfl", homeTeam: "E1", awayTeam: "E2", startsAt: new Date(`${PAST_DATE}T14:00:00.000Z`), status: "final" });
    await createTestPick(member.id, missGame.id, { selectedTeam: "E1" });
    await db.insert(result).values({ gameId: missGame.id, winningTeam: "E2", source: "seed" });

    const token = await tokenFor(owner.id);

    const futureRes = await app.inject({ method: "GET", url: `/leagues/${league.id}/slate?date=${FUTURE_DATE}`, headers: auth(token) });
    const futureByGame = new Map(futureRes.json().games.map((g: { gameId: string; pickState: string }) => [g.gameId, g.pickState]));
    expect(futureByGame.get(unpickedGame.id)).toBe("unpicked");
    expect(futureByGame.get(pickedOpenGame.id)).toBe("picked_open");

    const pastRes = await app.inject({ method: "GET", url: `/leagues/${league.id}/slate?date=${PAST_DATE}`, headers: auth(token) });
    const pastByGame = new Map(pastRes.json().games.map((g: { gameId: string; pickState: string }) => [g.gameId, g.pickState]));
    expect(pastByGame.get(lockedNoResultGame.id)).toBe("locked");
    expect(pastByGame.get(hitGame.id)).toBe("final_hit");
    expect(pastByGame.get(missGame.id)).toBe("final_miss");
  });

  it("pickedCount/totalCount reflect the caller's own picks for the slate", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const todayIso = new Date().toISOString().slice(0, 10);
    const baseTime = new Date(`${todayIso}T12:00:00.000Z`);

    const picked = await createTestGame({ sport: "nfl", startsAt: new Date(baseTime.getTime() + 3600_000) });
    await createTestPick(member.id, picked.id, { selectedTeam: "Home" });
    await createTestGame({ sport: "nfl", startsAt: new Date(baseTime.getTime() + 3600_000) });
    await createTestGame({ sport: "nfl", startsAt: new Date(baseTime.getTime() + 3600_000) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/slate?date=${todayIso}`, headers: auth(token) });

    expect(res.json()).toMatchObject({ pickedCount: 1, totalCount: 3 });
  });

  describe("privacy (JAC-35)", () => {
    it("before lock: shows hasPicked for other members but never their selectedTeam, while the caller's own myPick is always visible", async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
      const ownerMember = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
      const otherMember = await createTestLeagueMember(other.id, league.id, { role: "member" });

      const game = await createTestGame({
        sport: "nfl",
        homeTeam: "Bills",
        awayTeam: "Jets",
        startsAt: new Date(Date.now() + 3600_000),
      });
      await createTestPick(ownerMember.id, game.id, { selectedTeam: "Bills" });
      await createTestPick(otherMember.id, game.id, { selectedTeam: "Jets" });

      const token = await tokenFor(owner.id);
      const res = await app.inject({
        method: "GET",
        url: `/leagues/${league.id}/slate?date=${new Date(game.startsAt).toISOString().slice(0, 10)}`,
        headers: auth(token),
      });

      const slateGame = res.json().games.find((g: { gameId: string }) => g.gameId === game.id);
      expect(slateGame.locked).toBe(false);
      expect(slateGame.myPick).toBe("Bills"); // caller's own — always visible
      const otherEntry = slateGame.otherPicks.find((p: { leagueMemberId: string }) => p.leagueMemberId === otherMember.id);
      expect(otherEntry.hasPicked).toBe(true); // who has picked — visible
      expect(otherEntry.selectedTeam).toBeNull(); // what they picked — hidden before lock
    });

    it("after lock: reveals other members' selectedTeam too", async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
      const ownerMember = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
      const otherMember = await createTestLeagueMember(other.id, league.id, { role: "member" });

      const game = await createTestGame({
        sport: "nfl",
        homeTeam: "Bills",
        awayTeam: "Jets",
        startsAt: new Date(Date.now() - 3600_000), // already started -> locked
        status: "in_progress",
      });
      await createTestPick(ownerMember.id, game.id, { selectedTeam: "Bills" });
      await createTestPick(otherMember.id, game.id, { selectedTeam: "Jets" });

      const token = await tokenFor(owner.id);
      const res = await app.inject({
        method: "GET",
        url: `/leagues/${league.id}/slate?date=${new Date(game.startsAt).toISOString().slice(0, 10)}`,
        headers: auth(token),
      });

      const slateGame = res.json().games.find((g: { gameId: string }) => g.gameId === game.id);
      expect(slateGame.locked).toBe(true);
      const otherEntry = slateGame.otherPicks.find((p: { leagueMemberId: string }) => p.leagueMemberId === otherMember.id);
      expect(otherEntry.hasPicked).toBe(true);
      expect(otherEntry.selectedTeam).toBe("Jets"); // revealed once locked
    });

    it("a non-member cannot view the slate — real 403 over HTTP", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, { sports: ["nfl"] });
      await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
      const outsider = await createTestUser();

      const token = await tokenFor(outsider.id);
      const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/slate`, headers: auth(token) });

      expect(res.statusCode).toBe(403);
    });
  });
});
