import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
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

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describe("PUT /leagues/:leagueId/members/:memberId/golf-pick/:tournamentId", () => {
  it("a member can write their own golf pick", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 2 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ startsAt: hoursFromNow(24) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });
    const golferB = await createTestTournamentEntry(t.id, { externalId: "golfer-b" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/golf-pick/${t.id}`,
      headers: auth(token),
      payload: { golferExternalIds: [golferA.externalId, golferB.externalId] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().golferExternalIds.sort()).toEqual(["golfer-a", "golfer-b"]);
  });

  it("user A cannot write a golf pick as user B's member row — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 1 });
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id, { role: "member" });
    const memberB = await createTestLeagueMember(userB.id, league.id, { role: "member" });
    const t = await createTestTournament({ startsAt: hoursFromNow(24) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${memberB.id}/golf-pick/${t.id}`,
      headers: auth(tokenA),
      payload: { golferExternalIds: [golferA.externalId] },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request outright", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ startsAt: hoursFromNow(24) });

    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/golf-pick/${t.id}`,
      payload: { golferExternalIds: ["golfer-a"] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("maps a locked-tournament rejection to 409 GOLF_PICK_LOCKED over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 1 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ startsAt: hoursFromNow(-1) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/golf-pick/${t.id}`,
      headers: auth(token),
      payload: { golferExternalIds: [golferA.externalId] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("GOLF_PICK_LOCKED");
  });
});

describe("GET /leagues/:leagueId/golf/current", () => {
  it("returns the upcoming tournament, its field as a leaderboard, and the caller's own pick", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 1, golfTopN: 10 });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const t = await createTestTournament({ name: "Test Open", startsAt: hoursFromNow(24) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a", golferName: "Golfer A", position: null });

    const token = await tokenFor(owner.id);
    await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${member.id}/golf-pick/${t.id}`,
      headers: auth(token),
      payload: { golferExternalIds: [golferA.externalId] },
    });

    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournament.name).toBe("Test Open");
    expect(body.tournament.locked).toBe(false);
    expect(body.leaderboard).toHaveLength(1);
    expect(body.myPick).toEqual(["golfer-a"]);
    expect(body.golfPickCount).toBe(1);
    expect(body.golfTopN).toBe(10);
  });

  it("hides other members' selections until the tournament locks, but always shows hasPicked", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 1 });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const otherOwner = await createTestUser();
    const otherMember = await createTestLeagueMember(otherOwner.id, league.id, { role: "member" });
    const t = await createTestTournament({ startsAt: hoursFromNow(24) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });

    const otherToken = await tokenFor(otherOwner.id);
    await app.inject({
      method: "PUT",
      url: `/leagues/${league.id}/members/${otherMember.id}/golf-pick/${t.id}`,
      headers: auth(otherToken),
      payload: { golferExternalIds: [golferA.externalId] },
    });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const otherEntry = body.otherPicks.find((p: { leagueMemberId: string }) => p.leagueMemberId === otherMember.id);
    expect(otherEntry.hasPicked).toBe(true);
    expect(otherEntry.golferExternalIds).toBeNull(); // not locked yet — selection hidden
  });

  it("reveals other members' selections once the tournament has locked", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 1 });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const otherOwner = await createTestUser();
    const otherMember = await createTestLeagueMember(otherOwner.id, league.id, { role: "member" });
    // Started in the past so it's already locked by the time we read it —
    // note picks can no longer be WRITTEN once locked, so seed the pick
    // directly rather than through the write endpoint.
    const t = await createTestTournament({ startsAt: hoursFromNow(-1) });
    const golferA = await createTestTournamentEntry(t.id, { externalId: "golfer-a" });
    const gp = await createTestGolfPick(otherMember.id, t.id);
    await createTestGolfPickSelection(gp.id, golferA.id);

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournament.locked).toBe(true);
    const otherEntry = body.otherPicks.find((p: { leagueMemberId: string }) => p.leagueMemberId === otherMember.id);
    expect(otherEntry.golferExternalIds).toEqual(["golfer-a"]);
  });

  it("returns a null tournament with defaults when no tournament exists at all", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"], golfPickCount: 3, golfTopN: 10 });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournament).toBeNull();
    expect(body.leaderboard).toEqual([]);
    expect(body.myPick).toBeNull();
    expect(body.golfPickCount).toBe(3);
  });

  it("rejects an unauthenticated request outright", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"] });
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current` });
    expect(res.statusCode).toBe(401);
  });

  it("user not in the league gets a real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["golf"] });
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const outsider = await createTestUser();

    const token = await tokenFor(outsider.id);
    const res = await app.inject({ method: "GET", url: `/leagues/${league.id}/golf/current`, headers: auth(token) });

    expect(res.statusCode).toBe(403);
  });
});
