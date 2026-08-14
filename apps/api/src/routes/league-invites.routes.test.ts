import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { leagueInviteCode, leagueMember, pick } from "../db/schema.js";
import {
  createTestGame,
  createTestInviteCode,
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

describe("GET /leagues/:leagueId/invite-code", () => {
  it("the commissioner can view the invite code", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/invite-code`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(code.code);
    expect(res.json().deepLink).toContain(code.code);
  });

  it("a non-commissioner cannot view the invite code", async () => {
    const owner = await createTestUser();
    const regular = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    await createTestLeagueMember(regular.id, testLeague.id, { role: "member" });
    await createTestInviteCode(testLeague.id);

    const token = await tokenFor(regular.id);
    const res = await app.inject({
      method: "GET",
      url: `/leagues/${testLeague.id}/invite-code`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /leagues/:leagueId/invite-code", () => {
  it("rotate generates a new code and resets uses_count", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const original = await createTestInviteCode(testLeague.id, { usesCount: 3 });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}/invite-code`,
      headers: auth(token),
      payload: { rotate: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).not.toBe(original.code);
    expect(res.json().usesCount).toBe(0);
  });

  it("updates maxUses/expiresAt without rotating the code value", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const original = await createTestInviteCode(testLeague.id);

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "PATCH",
      url: `/leagues/${testLeague.id}/invite-code`,
      headers: auth(token),
      payload: { maxUses: 10 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(original.code); // unchanged
    expect(res.json().maxUses).toBe(10);
  });
});

describe("GET /leagues/preview", () => {
  it("returns name, sports, memberCount for a valid code", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id, { name: "Preview League", sports: ["nfl", "nba"] });
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const someone = await createTestUser();
    const token = await tokenFor(someone.id);
    const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}`, headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Preview League");
    expect(body.sports).toEqual(["nfl", "nba"]);
    expect(body.memberCount).toBe(1);
    expect(body.alreadyMember).toBe(false);
  });

  it("indicates alreadyMember for an existing active member", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}`, headers: auth(token) });

    expect(res.json().alreadyMember).toBe(true);
  });

  it("404s for an unknown code", async () => {
    const someone = await createTestUser();
    const token = await tokenFor(someone.id);
    const res = await app.inject({ method: "GET", url: "/leagues/preview?code=NOTREAL1", headers: auth(token) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("INVITE_CODE_NOT_FOUND");
  });

  it("410s for an expired code", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id, { expiresAt: new Date(Date.now() - 1000) });

    const someone = await createTestUser();
    const token = await tokenFor(someone.id);
    const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}`, headers: auth(token) });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("INVITE_CODE_EXPIRED");
  });

  it("409s for a code that's reached max uses", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id, { maxUses: 1, usesCount: 1 });

    const someone = await createTestUser();
    const token = await tokenFor(someone.id);
    const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}`, headers: auth(token) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVITE_CODE_MAX_USES_REACHED");
  });

  /**
   * JAC-43-48 regression: this endpoint's rate limit used to be a
   * SILENT no-op — derived via a second `app.rateLimit()` call off the
   * same registration as the route-level `config.rateLimit` check,
   * both sharing one single-fire-per-request guard, so only the first
   * ever actually ran. Now a genuinely independent registration
   * (lib/rate-limit.ts) — this asserts it actually rejects the 11th
   * request in the window.
   *
   * Keyed by IP, not by account (Epic 11 — see league-invites.routes.ts's
   * own top comment): `/preview` must work for a visitor with no
   * account at all, so there's no user id to key on pre-auth. This is
   * a deliberate change from this endpoint's original per-user
   * keying — a different user from the SAME ip (what `app.inject()`
   * simulates for every call in this file) is correctly caught by the
   * same limit here, unlike the old per-user version.
   */
  it("limits 10 requests/minute per IP, regardless of which account is calling", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const someone = await createTestUser();
    const token = await tokenFor(someone.id);

    let lastStatus = 200;
    let lastBody: unknown;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}`, headers: auth(token) });
      lastStatus = res.statusCode;
      lastBody = res.json();
    }
    expect(lastStatus).toBe(429);
    expect((lastBody as { error: { code: string; retryAfterSeconds: number } }).error.code).toBe("RATE_LIMITED");
    expect((lastBody as { error: { retryAfterSeconds: number } }).error.retryAfterSeconds).toBeGreaterThan(0);

    // A different account, same (simulated) IP — still limited, since
    // the key is the IP, not the account.
    const other = await createTestUser();
    const otherToken = await tokenFor(other.id);
    const otherRes = await app.inject({
      method: "GET",
      url: `/leagues/preview?code=${code.code}`,
      headers: auth(otherToken),
    });
    expect(otherRes.statusCode).toBe(429);
  });

  it("works with no Authorization header at all — a visitor with no account yet", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id, { name: "Public Preview League" });
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const res = await app.inject({ method: "GET", url: `/leagues/preview?code=${code.code}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Public Preview League");
    expect(body.alreadyMember).toBe(false);
  });
});

describe("POST /leagues/join", () => {
  /**
   * Regression for the Epic 11 auth-split fix: `/preview` became
   * public, but `/join` genuinely can't — it attaches a membership row
   * to a real userId, so there's nothing to attach it to without one.
   */
  it("still requires authentication — the /preview fix does not leak to /join", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const res = await app.inject({ method: "POST", url: "/leagues/join", payload: { code: code.code } });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("joins the league and increments uses_count", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id, { name: "Join Me" });
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const joiner = await createTestUser();
    const token = await tokenFor(joiner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: code.code } });

    expect(res.statusCode).toBe(200);
    expect(res.json().leagueName).toBe("Join Me");

    const [member] = await db
      .select()
      .from(leagueMember)
      .where(and(eq(leagueMember.userId, joiner.id), eq(leagueMember.leagueId, testLeague.id)));
    expect(member!.role).toBe("member");
    expect(member!.leftAt).toBeNull();

    const [codeRow] = await db.select().from(leagueInviteCode).where(eq(leagueInviteCode.id, code.id));
    expect(codeRow!.usesCount).toBe(1);
  });

  it("REJOINING restores prior picks — reactivates the same league_member row rather than creating a new one", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const rejoiner = await createTestUser();
    const originalMember = await createTestLeagueMember(rejoiner.id, testLeague.id, { role: "member" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    await createTestPick(originalMember.id, g.id, { selectedTeam: "Bills" });

    // Leave.
    const token = await tokenFor(rejoiner.id);
    await app.inject({ method: "POST", url: `/leagues/${testLeague.id}/leave`, headers: auth(token) });
    const [afterLeave] = await db.select().from(leagueMember).where(eq(leagueMember.id, originalMember.id));
    expect(afterLeave!.leftAt).not.toBeNull();

    // Rejoin via the invite code.
    const code = await createTestInviteCode(testLeague.id);
    const rejoinRes = await app.inject({
      method: "POST",
      url: "/leagues/join",
      headers: auth(token),
      payload: { code: code.code },
    });
    expect(rejoinRes.statusCode).toBe(200);

    const allMembers = await db
      .select()
      .from(leagueMember)
      .where(and(eq(leagueMember.userId, rejoiner.id), eq(leagueMember.leagueId, testLeague.id)));
    expect(allMembers).toHaveLength(1); // same row reactivated, not a second one
    expect(allMembers[0]!.id).toBe(originalMember.id);
    expect(allMembers[0]!.leftAt).toBeNull();

    const picks = await db.select().from(pick).where(eq(pick.leagueMemberId, originalMember.id));
    expect(picks).toHaveLength(1);
    expect(picks[0]!.selectedTeam).toBe("Bills"); // the prior pick survived, untouched
  });

  it("404s for an unknown code", async () => {
    const joiner = await createTestUser();
    const token = await tokenFor(joiner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: "NOTREAL1" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("INVITE_CODE_NOT_FOUND");
  });

  it("410s for an expired code", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id, { expiresAt: new Date(Date.now() - 1000) });

    const joiner = await createTestUser();
    const token = await tokenFor(joiner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: code.code } });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("INVITE_CODE_EXPIRED");
  });

  it("409s once max uses is reached", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id, { maxUses: 1, usesCount: 1 });

    const joiner = await createTestUser();
    const token = await tokenFor(joiner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: code.code } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVITE_CODE_MAX_USES_REACHED");
  });

  it("409s LEAGUE_FULL once MAX_LEAGUE_MEMBERS is reached", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    // env.MAX_LEAGUE_MEMBERS defaults to 100 — fixture-fill up to it.
    for (let i = 0; i < 99; i++) {
      const u = await createTestUser();
      await createTestLeagueMember(u.id, testLeague.id, { role: "member" });
    }
    const code = await createTestInviteCode(testLeague.id);

    const joiner = await createTestUser();
    const token = await tokenFor(joiner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: code.code } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LEAGUE_FULL");
  });

  it("under concurrent redemption of a max_uses:1 code, exactly one join succeeds", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id, { maxUses: 1 });

    const joinerA = await createTestUser();
    const joinerB = await createTestUser();
    const tokenA = await tokenFor(joinerA.id);
    const tokenB = await tokenFor(joinerB.id);

    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: "/leagues/join", headers: auth(tokenA), payload: { code: code.code } }),
      app.inject({ method: "POST", url: "/leagues/join", headers: auth(tokenB), payload: { code: code.code } }),
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    expect(statusCodes).toEqual([200, 409]);

    const [codeRow] = await db.select().from(leagueInviteCode).where(eq(leagueInviteCode.id, code.id));
    expect(codeRow!.usesCount).toBe(1); // never overshoots

    const members = await db.select().from(leagueMember).where(eq(leagueMember.leagueId, testLeague.id));
    expect(members).toHaveLength(2); // owner + exactly one successful joiner
  });

  it("rejoining an already-active membership is an idempotent no-op success", async () => {
    const owner = await createTestUser();
    const testLeague = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, testLeague.id, { role: "commissioner" });
    const code = await createTestInviteCode(testLeague.id);

    const token = await tokenFor(owner.id);
    const res = await app.inject({ method: "POST", url: "/leagues/join", headers: auth(token), payload: { code: code.code } });
    expect(res.statusCode).toBe(200);

    const members = await db.select().from(leagueMember).where(eq(leagueMember.leagueId, testLeague.id));
    expect(members).toHaveLength(1);
  });
});
