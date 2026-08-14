import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { leagueMember, pick, result } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
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

/**
 * The literal JAC-17 scenario: "authenticate as user A and attempt to
 * read user B's picks in a league A doesn't belong to. This must fail
 * at the API, not merely be hidden client-side." — exercised here via
 * real HTTP through app.inject(), not by calling the authorization
 * helpers directly (that's covered separately in lib/authorization.test.ts).
 */
describe("GET /leagues — my leagues", () => {
  it("includes the caller's own leagueMemberId for each league (Epic 10)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: "/leagues", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const [entry] = res.json();
    expect(entry.leagueMemberId).toBe(member.id);
  });
});

describe("GET /leagues/:leagueId/picks — membership check", () => {
  it("a league member can read the league's picks", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { name: "Members Only" });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    await createTestPick(member.id, game.id, { selectedTeam: "Bills" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/picks`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("user A cannot read picks in a league A doesn't belong to — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const userA = await createTestUser();
    // userA is deliberately NOT added as a member of `league`.

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/picks`, headers: auth(tokenA) });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request outright", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/picks` });
    expect(res.statusCode).toBe(401);
  });
});

describe("PUT /leagues/:leagueId/members/:memberId/picks/:gameId — ownership check", () => {
  it("a member can write their own pick", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    // Future startsAt: createTestGame's default (~now) would otherwise
    // be correctly rejected as locked by JAC-31-36's lock enforcement,
    // which didn't exist when this ownership-check test was written —
    // this test is about ownership, not locking.
    const game = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: new Date(Date.now() + 3600_000) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/picks/${game.id}`,
      headers: auth(token),
      payload: { selectedTeam: "Chiefs" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().selectedTeam).toBe("Chiefs");
  });

  it("user A cannot write a pick as user B's member row — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id, { role: "member" });
    const memberB = await createTestLeagueMember(userB.id, league.id, { role: "member" });
    const game = await createTestGame({ homeTeam: "Packers", awayTeam: "Bears", startsAt: new Date(Date.now() + 3600_000) });

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${memberB.id}/picks/${game.id}`,
      headers: auth(tokenA),
      payload: { selectedTeam: "Packers" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("PATCH /leagues/:leagueId/members/:memberId/notifications", () => {
  it("a member can flip their own per-league notification preference", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}/members/${member.id}/notifications`,
      headers: auth(token),
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notificationsEnabled: false });

    const [row] = await db.select().from(leagueMember).where(eq(leagueMember.id, member.id)).limit(1);
    expect(row?.notificationsEnabled).toBe(false);
  });

  it("user A cannot flip user B's per-league preference — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id, { role: "member" });
    const memberB = await createTestLeagueMember(userB.id, league.id, { role: "member" });

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}/members/${memberB.id}/notifications`,
      headers: auth(tokenA),
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request outright", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}/members/${member.id}/notifications`,
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing enabled field", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}/members/${member.id}/notifications`,
      headers: auth(token),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /leagues/:leagueId/members/:memberId/picks/:gameId — rate limiting (JAC-43-48)", () => {
  it("limits one member to PICK_WRITE_RATE_LIMIT_PER_MINUTE writes/minute, independently of a different member", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const games = await Promise.all(
      Array.from({ length: 31 }, () =>
        createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: new Date(Date.now() + 3600_000) }),
      ),
    );
    const token = await tokenFor(owner.id);

    let lastStatus = 200;
    let lastBody: unknown;
    for (const g of games) {
      const res = await app.inject({
        method: "PUT",
        url: `/leagues/${league.id}/members/${member.id}/picks/${g.id}`,
        headers: auth(token),
        payload: { selectedTeam: "Bills" },
      });
      lastStatus = res.statusCode;
      lastBody = res.json();
    }
    expect(lastStatus).toBe(429);
    expect((lastBody as { error: { code: string; retryAfterSeconds: number } }).error.code).toBe("RATE_LIMITED");
    expect((lastBody as { error: { retryAfterSeconds: number } }).error.retryAfterSeconds).toBeGreaterThan(0);

    // A different member, in a different league, has their own budget.
    const otherOwner = await createTestUser();
    const otherLeague = await createTestLeague(otherOwner.id);
    const otherMember = await createTestLeagueMember(otherOwner.id, otherLeague.id, { role: "commissioner" });
    const otherGame = await createTestGame({
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date(Date.now() + 3600_000),
    });
    const otherToken = await tokenFor(otherOwner.id);
    const otherRes = await app.inject({
      method: "PUT",
      url: `/leagues/${otherLeague.id}/members/${otherMember.id}/picks/${otherGame.id}`,
      headers: auth(otherToken),
      payload: { selectedTeam: "Chiefs" },
    });
    expect(otherRes.statusCode).toBe(200);
  });
});

/**
 * JAC-33 (lock enforcement, "the single most important correctness
 * requirement in the app") — the literal required tests, hitting the
 * API directly, not calling writePick() as an internal function.
 */
describe("PUT /leagues/:leagueId/members/:memberId/picks/:gameId — lock enforcement", () => {
  it("a pick submitted one second before the game's start is accepted", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: new Date(Date.now() + 1000) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/picks/${game.id}`,
      headers: auth(token),
      payload: { selectedTeam: "Bills" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("a pick submitted one second after the game's start is rejected with PICK_LOCKED", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: new Date(Date.now() - 1000) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/picks/${game.id}`,
      headers: auth(token),
      payload: { selectedTeam: "Bills" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PICK_LOCKED");

    const picks = await db.select().from(pick).where(eq(pick.gameId, game.id));
    expect(picks).toHaveLength(0);
  });

  it("a game moved EARLIER, then picked after the new (earlier) start time, is rejected — the current start time is always re-read at write time", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    // Originally scheduled comfortably in the future...
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: new Date(Date.now() + 3600_000) });

    // ...then schedule-ingest (simulated directly here) moves it
    // earlier, into the past, before the pick is ever attempted.
    const { game: gameTable } = await import("../db/schema.js");
    await db.update(gameTable).set({ startsAt: new Date(Date.now() - 1000) }).where(eq(gameTable.id, game.id));

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/picks/${game.id}`,
      headers: auth(token),
      payload: { selectedTeam: "Bills" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PICK_LOCKED");
  });

  it("rejects a canceled game with GAME_CANCELED, not PICK_LOCKED", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date(Date.now() + 3600_000),
      status: "canceled",
    });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/picks/${game.id}`,
      headers: auth(token),
      payload: { selectedTeam: "Bills" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("GAME_CANCELED");
  });
});

describe("PATCH /leagues/:leagueId — commissioner-only check", () => {
  it("the commissioner can rename the league", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}`,
      headers: auth(token),
      payload: { name: "Renamed League" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed League");
  });

  it("the commissioner can change the pick horizon", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}`,
      headers: auth(token),
      payload: { pickHorizonDays: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().pickHorizonDays).toBe(2);
  });

  it("rejects a pick horizon outside 1-30 days", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}`,
      headers: auth(token),
      payload: { pickHorizonDays: 31 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("a non-commissioner member cannot rename the league — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { name: "Original Name" });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const regular = await createTestUser();
    await createTestLeagueMember(regular.id, league.id, { role: "member" });

    const token = await tokenFor(regular.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${league.id}`,
      headers: auth(token),
      payload: { name: "Hijacked Name" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("POST /leagues — create", () => {
  it("creates a league, makes the creator commissioner and first member, and issues an invite code", async () => {
    const creator = await createTestUser({ timezone: "America/Chicago" });
    const token = await tokenFor(creator.id);

    const res = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "Office League", sports: ["nfl", "nba"], seasonStart: "2026-09-01" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Office League");
    expect(body.commissionerId).toBe(creator.id);
    expect(body.timezone).toBe("America/Chicago"); // defaulted from the creator
    expect(body.memberCount).toBe(1);
    expect(typeof body.inviteCode).toBe("string");
    expect(body.inviteCode).toHaveLength(8);

    const [member] = await db
      .select()
      .from(leagueMember)
      .where(and(eq(leagueMember.userId, creator.id), eq(leagueMember.leagueId, body.id)));
    expect(member!.role).toBe("commissioner");
  });

  it("defaults pickHorizonDays to 7 when omitted, and accepts an explicit override", async () => {
    const creator = await createTestUser();
    const token = await tokenFor(creator.id);

    const defaultRes = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "Default Horizon League", sports: ["nfl"], seasonStart: "2026-09-01" },
    });
    expect(defaultRes.json().pickHorizonDays).toBe(7);

    const overrideRes = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "Short Horizon League", sports: ["nfl"], seasonStart: "2026-09-01", pickHorizonDays: 2 },
    });
    expect(overrideRes.json().pickHorizonDays).toBe(2);
  });

  it("rejects a pick horizon outside 1-30 days", async () => {
    const creator = await createTestUser();
    const token = await tokenFor(creator.id);

    const res = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "Bad Horizon League", sports: ["nfl"], seasonStart: "2026-09-01", pickHorizonDays: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown sport code", async () => {
    const creator = await createTestUser();
    const token = await tokenFor(creator.id);

    const res = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "Bad Sport League", sports: ["curling"], seasonStart: "2026-09-01" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an offensive league name", async () => {
    const creator = await createTestUser();
    const token = await tokenFor(creator.id);

    const res = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "This League is Shit", sports: ["nfl"], seasonStart: "2026-09-01" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields[0].field).toBe("name");
  });

  it("enforces MAX_LEAGUES_PER_USER", async () => {
    const creator = await createTestUser();
    const token = await tokenFor(creator.id);

    // env.MAX_LEAGUES_PER_USER defaults to 25 — create leagues up to the
    // limit directly via the fixture (fast), then confirm the 26th via
    // the real route is rejected.
    for (let i = 0; i < 25; i++) {
      const l = await createTestLeague(creator.id, { name: `League ${i}` });
      await createTestLeagueMember(creator.id, l.id, { role: "commissioner" });
    }

    const res = await app.inject({
      method: "POST",
      url: "/leagues",
      headers: auth(token),
      payload: { name: "One Too Many", sports: ["nfl"], seasonStart: "2026-09-01" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MAX_LEAGUES_REACHED");
  });
});

describe("GET /leagues — multi-league home screen", () => {
  it("returns record, rank, gamesParticipated, and unpickedCount for each active league", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const testLeague = await createTestLeague(alice.id, { sports: ["nfl"] });
    const aliceMember = await createTestLeagueMember(alice.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(bob.id, testLeague.id, { role: "member" });

    const gradedWin = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets", status: "final" });
    await db.insert(result).values({ gameId: gradedWin.id, winningTeam: "Bills", source: "seed" });
    const winningPick = await createTestPick(aliceMember.id, gradedWin.id, { selectedTeam: "Bills" });
    // The home screen reads pick.outcome directly (JAC-37-42), not a
    // live join against result — grade the pick explicitly rather than
    // relying on the old selected_team = winning_team comparison.
    await db.update(pick).set({ outcome: "win", gradedAt: new Date() }).where(eq(pick.id, winningPick.id));

    const upcoming = await createTestGame({
      sport: "nfl",
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date(Date.now() + 3600_000),
    });

    const token = await tokenFor(alice.id);
    const res = await app.inject({ method: "GET", url: "/leagues", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const [entry] = res.json();
    expect(entry.id).toBe(testLeague.id);
    expect(entry.record).toEqual({ wins: 1, losses: 0 });
    expect(entry.gamesParticipated).toBe(1);
    expect(entry.rank).toBe(1);
    expect(entry.memberCount).toBe(2);
    expect(entry.unpickedCount).toBe(1); // `upcoming` has no pick yet
    expect(entry.nextLockAt).not.toBeNull();
    void upcoming;
  });

  it("excludes an unpicked game beyond the league's pick horizon from unpickedCount/nextLockAt", async () => {
    const alice = await createTestUser();
    const testLeague = await createTestLeague(alice.id, { sports: ["nfl"], pickHorizonDays: 3 });
    await createTestLeagueMember(alice.id, testLeague.id, { role: "commissioner" });

    // Inside the 3-day horizon — should count.
    await createTestGame({
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      startsAt: new Date(Date.now() + 24 * 3600_000), // 1 day out
    });
    // Beyond the 3-day horizon — should NOT count, the exact "176
    // unpicked games" bug this bound fixes.
    await createTestGame({
      sport: "nfl",
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      startsAt: new Date(Date.now() + 10 * 24 * 3600_000), // 10 days out
    });

    const token = await tokenFor(alice.id);
    const res = await app.inject({ method: "GET", url: "/leagues", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const [entry] = res.json();
    expect(entry.unpickedCount).toBe(1);
  });

  it("orders leagues with open picks before leagues with none, soonest lock first", async () => {
    const alice = await createTestUser();
    const leagueWithOpenPicks = await createTestLeague(alice.id, { name: "Has Open Picks", sports: ["nfl"] });
    await createTestLeagueMember(alice.id, leagueWithOpenPicks.id, { role: "commissioner" });
    await createTestGame({ sport: "nfl", startsAt: new Date(Date.now() + 3600_000) });

    const leagueWithNoOpenPicks = await createTestLeague(alice.id, { name: "All Caught Up", sports: ["mlb"] });
    await createTestLeagueMember(alice.id, leagueWithNoOpenPicks.id, { role: "commissioner" });

    const token = await tokenFor(alice.id);
    const res = await app.inject({ method: "GET", url: "/leagues", headers: auth(token) });

    const names = res.json().map((l: { name: string }) => l.name);
    expect(names[0]).toBe("Has Open Picks");
    expect(names[1]).toBe("All Caught Up");
  });

  it("returns an empty array for a user in no leagues", async () => {
    const lonely = await createTestUser();
    const token = await tokenFor(lonely.id);
    const res = await app.inject({ method: "GET", url: "/leagues", headers: auth(token) });
    expect(res.json()).toEqual([]);
  });
});

describe("Sports-selection freeze", () => {
  it("allows changing sports before any game is graded", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}`,
      headers: auth(token),
      payload: { sports: ["nfl", "nba"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sports).toEqual(["nfl", "nba"]);
  });

  it("rejects changing sports once the league has a graded game", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id, {
      sports: ["nfl"],
      seasonStart: "2020-01-01",
      timezone: "UTC",
    });
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const gradedGame = await createTestGame({
      sport: "nfl",
      status: "final",
      startsAt: new Date("2020-06-01T00:00:00Z"),
    });
    await db.insert(result).values({ gameId: gradedGame.id, winningTeam: "Home", source: "seed" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}`,
      headers: auth(token),
      payload: { sports: ["nba"] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SPORTS_SELECTION_FROZEN");
  });
});

describe("DELETE /leagues/:leagueId — commissioner deletes the league", () => {
  it("cascades to members and picks", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    const ownerMember = await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    await createTestPick(ownerMember.id, g.id, { selectedTeam: "Bills" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "DELETE", url: `/leagues/${testLeague.id}`, headers: auth(token) });

    expect(res.statusCode).toBe(204);
    const remainingPicks = await db.select().from(pick).where(eq(pick.leagueMemberId, ownerMember.id));
    expect(remainingPicks).toHaveLength(0);
    const remainingMembers = await db.select().from(leagueMember).where(eq(leagueMember.leagueId, testLeague.id));
    expect(remainingMembers).toHaveLength(0);
  });

  it("a non-commissioner cannot delete the league", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const regular = await createTestUser();
    await createTestLeagueMember(regular.id, testLeague.id, { role: "member" });

    const token = await tokenFor(regular.id);
    const res = await app.inject({ method: "DELETE", url: `/leagues/${testLeague.id}`, headers: auth(token) });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /leagues/:leagueId/transfer-commissioner", () => {
  it("transfers the role and updates who passes requireLeagueCommissioner", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const otherMember = await createTestLeagueMember(other.id, testLeague.id, { role: "member" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${testLeague.id}/transfer-commissioner`,
      headers: auth(token),
      payload: { newCommissionerMemberId: otherMember.id },
    });

    expect(res.statusCode).toBe(200);

    // The old commissioner can no longer rename the league...
    const oldOwnerAttempt = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}`,
      headers: auth(token),
      payload: { name: "Should Fail" },
    });
    expect(oldOwnerAttempt.statusCode).toBe(403);

    // ...and the new commissioner can.
    const newOwnerToken = await tokenFor(other.id);
    const newOwnerAttempt = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}`,
      headers: auth(newOwnerToken),
      payload: { name: "New Commissioner Renamed It" },
    });
    expect(newOwnerAttempt.statusCode).toBe(200);
  });

  it("rejects transferring to someone who isn't an active member", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${testLeague.id}/transfer-commissioner`,
      headers: auth(token),
      payload: { newCommissionerMemberId: "00000000-0000-0000-0000-000000000099" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /leagues/:leagueId/leave", () => {
  it("a regular member can leave; leaving is soft (picks preserved, left_at set)", async () => {
    const owner = await createTestUser();
    const departing = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const departingMember = await createTestLeagueMember(departing.id, testLeague.id, { role: "member" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    await createTestPick(departingMember.id, g.id, { selectedTeam: "Bills" });

    const token = await tokenFor(departing.id);
    const res = await app.inject({ method: "POST", url: `/leagues/${testLeague.id}/leave`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(leagueMember).where(eq(leagueMember.id, departingMember.id));
    expect(row!.leftAt).not.toBeNull();
    const picks = await db.select().from(pick).where(eq(pick.leagueMemberId, departingMember.id));
    expect(picks).toHaveLength(1); // untouched

    // And can no longer read league picks — requireLeagueMembership now
    // filters left_at.
    const afterLeave = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/picks`,
      headers: auth(token),
    });
    expect(afterLeave.statusCode).toBe(403);
  });

  it("blocks the sole commissioner from leaving while other members remain", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(other.id, testLeague.id, { role: "member" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "POST", url: `/leagues/${testLeague.id}/leave`, headers: auth(token) });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("COMMISSIONER_MUST_TRANSFER_FIRST");
  });

  it("directs the sole remaining member (also commissioner) to delete instead of leave", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "POST", url: `/leagues/${testLeague.id}/leave`, headers: auth(token) });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SOLE_MEMBER_USE_DELETE");
  });
});

describe("DELETE /leagues/:leagueId/members/:memberId — commissioner removes a member", () => {
  it("removes the member (soft) while preserving their picks", async () => {
    const owner = await createTestUser();
    const target = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const targetMember = await createTestLeagueMember(target.id, testLeague.id, { role: "member" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    await createTestPick(targetMember.id, g.id, { selectedTeam: "Bills" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "DELETE",
      url: `/leagues/${testLeague.id}/members/${targetMember.id}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(204);
    const [row] = await db.select().from(leagueMember).where(eq(leagueMember.id, targetMember.id));
    expect(row!.leftAt).not.toBeNull();
    const picks = await db.select().from(pick).where(eq(pick.leagueMemberId, targetMember.id));
    expect(picks).toHaveLength(1);
  });

  it("the commissioner cannot remove themselves via this route", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    const ownerMember = await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "DELETE",
      url: `/leagues/${testLeague.id}/members/${ownerMember.id}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CANNOT_REMOVE_SELF");
  });

  it("a non-commissioner cannot remove another member", async () => {
    const owner = await createTestUser();
    const target = await createTestUser();
    const regular = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const targetMember = await createTestLeagueMember(target.id, testLeague.id, { role: "member" });
    await createTestLeagueMember(regular.id, testLeague.id, { role: "member" });

    const token = await tokenFor(regular.id);
    const res = await app.inject({
      method: "DELETE",
      url: `/leagues/${testLeague.id}/members/${targetMember.id}`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /leagues/:leagueId/members — pagination", () => {
  it("paginates and excludes departed members", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    for (let i = 0; i < 3; i++) {
      const u = await createTestUser();
      await createTestLeagueMember(u.id, testLeague.id, { role: "member" });
    }
    const departedUser = await createTestUser();
    await createTestLeagueMember(departedUser.id, testLeague.id, { role: "member", leftAt: new Date() });

    const token = await tokenFor(owner.id);
    const page1 = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/members?limit=2`,
      headers: auth(token),
    });

    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data).toHaveLength(2);
    expect(body1.pagination.next_cursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/members?limit=2&cursor=${encodeURIComponent(body1.pagination.next_cursor)}`,
      headers: auth(token),
    });
    const body2 = page2.json();
    expect(body2.data).toHaveLength(2); // 4 active members total (owner + 3), page 2 has the remaining 2
    expect(body2.pagination.next_cursor).toBeNull();

    const allIds = [...body1.data, ...body2.data].map((m: { id: string }) => m.id);
    expect(new Set(allIds).size).toBe(4);
    expect(allIds).not.toContain(
      (await db.select().from(leagueMember).where(eq(leagueMember.userId, departedUser.id)))[0]!.id,
    );
  });
});

describe("Member reporting", () => {
  it("a member can report another member, and the commissioner can see it", async () => {
    const owner = await createTestUser();
    const reporter = await createTestUser();
    const reported = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const reporterMember = await createTestLeagueMember(reporter.id, testLeague.id, { role: "member" });
    const reportedMember = await createTestLeagueMember(reported.id, testLeague.id, { role: "member" });

    const token = await tokenFor(reporter.id);
    const reportRes = await app.inject({
      method: "POST",
      url: `/leagues/${testLeague.id}/members/${reportedMember.id}/report`,
      headers: auth(token),
      payload: { reason: "Trash talk got personal" },
    });
    expect(reportRes.statusCode).toBe(201);
    void reporterMember;

    const ownerToken = await tokenFor(owner.id);
    const listRes = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/reports`,
      headers: auth(ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0].reason).toBe("Trash talk got personal");
  });

  it("cannot report yourself", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    const ownerMember = await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${testLeague.id}/members/${ownerMember.id}/report`,
      headers: auth(token),
      payload: { reason: "self" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("a non-commissioner cannot view the report list", async () => {
    const owner = await createTestUser();
    const regular = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(regular.id, testLeague.id, { role: "member" });

    const token = await tokenFor(regular.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/reports`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(403);
  });
});
