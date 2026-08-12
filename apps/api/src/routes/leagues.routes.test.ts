import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
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
    const game = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders" });

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
    const game = await createTestGame({ homeTeam: "Packers", awayTeam: "Bears" });

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
