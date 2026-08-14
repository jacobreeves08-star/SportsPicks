import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { pick } from "../db/schema.js";
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

async function signupAndLogin(email: string, password = "correcthorsebattery") {
  await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password, displayName: "Test", timezone: "UTC" },
  });
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  return res.json() as { accessToken: string; refreshToken: string };
}

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

describe("GET /users/me", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/users/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({ method: "GET", url: "/users/me", headers: auth("not-a-real-token") });
    expect(res.statusCode).toBe(401);
  });

  it("succeeds with a valid token and never includes password_hash", async () => {
    const { accessToken } = await signupAndLogin("me1@example.com");
    const res = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("me1@example.com");
    expect(body).not.toHaveProperty("passwordHash");
    expect(body).not.toHaveProperty("password_hash");
  });

  it("defaults notificationsEnabled to true, and reflects a change made via PATCH /me/notifications", async () => {
    const { accessToken } = await signupAndLogin("me2@example.com");
    const before = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(before.json().notificationsEnabled).toBe(true);

    await app.inject({
      method: "PATCH",
      url: "/users/me/notifications",
      headers: auth(accessToken),
      payload: { enabled: false },
    });

    const after = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(after.json().notificationsEnabled).toBe(false);
  });
});

describe("PATCH /users/me", () => {
  it("updates displayName", async () => {
    const { accessToken } = await signupAndLogin("patch1@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { displayName: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("New Name");
  });

  it("changing timezone includes a lock-time warning", async () => {
    const { accessToken } = await signupAndLogin("patch2@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { timezone: "America/Chicago" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toMatch(/lock/i);
  });

  it("rejects an invalid timezone with the validation envelope", async () => {
    const { accessToken } = await signupAndLogin("patch3@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me",
      headers: auth(accessToken),
      payload: { timezone: "Nowhere/Fake" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields[0].field).toBe("timezone");
  });
});

describe("PATCH /users/me/notifications", () => {
  it("turns the global notification switch off", async () => {
    const { accessToken } = await signupAndLogin("notif1@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/notifications",
      headers: auth(accessToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notificationsEnabled: false });
  });

  it("turns it back on", async () => {
    const { accessToken } = await signupAndLogin("notif2@example.com");
    await app.inject({
      method: "PATCH",
      url: "/users/me/notifications",
      headers: auth(accessToken),
      payload: { enabled: false },
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/notifications",
      headers: auth(accessToken),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notificationsEnabled: true });
  });

  it("rejects a missing enabled field", async () => {
    const { accessToken } = await signupAndLogin("notif3@example.com");
    const res = await app.inject({
      method: "PATCH",
      url: "/users/me/notifications",
      headers: auth(accessToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "PATCH", url: "/users/me/notifications", payload: { enabled: false } });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /users/me/change-password", () => {
  it("rejects the wrong current password", async () => {
    const { accessToken } = await signupAndLogin("changepw1@example.com", "originalpassword");
    const res = await app.inject({
      method: "POST",
      url: "/users/me/change-password",
      headers: auth(accessToken),
      payload: { currentPassword: "wrongpassword", newPassword: "newpassword123" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("CURRENT_PASSWORD_INCORRECT");
  });

  it("with the correct current password: revokes OTHER sessions but not the one used for the change", async () => {
    const { accessToken: sessionA } = await signupAndLogin("changepw2@example.com", "originalpassword");
    const loginB = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "changepw2@example.com", password: "originalpassword" },
    });
    const sessionB = loginB.json().accessToken as string;

    const changeRes = await app.inject({
      method: "POST",
      url: "/users/me/change-password",
      headers: auth(sessionA),
      payload: { currentPassword: "originalpassword", newPassword: "newpassword123" },
    });
    expect(changeRes.statusCode).toBe(200);

    const checkA = await app.inject({ method: "GET", url: "/users/me", headers: auth(sessionA) });
    const checkB = await app.inject({ method: "GET", url: "/users/me", headers: auth(sessionB) });
    expect(checkA.statusCode).toBe(200);
    expect(checkB.statusCode).toBe(401);
  });
});

describe("POST /users/me/deletion-request", () => {
  it("revokes every session, including the one used for the request itself", async () => {
    const { accessToken } = await signupAndLogin("delete1@example.com");

    const res = await app.inject({ method: "POST", url: "/users/me/deletion-request", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("scheduledDeletionAt");

    const after = await app.inject({ method: "GET", url: "/users/me", headers: auth(accessToken) });
    expect(after.statusCode).toBe(401);
  });

  it("deletion-cancel clears the scheduled deletion (verified via a fresh login)", async () => {
    const { accessToken } = await signupAndLogin("delete2@example.com", "somepassword");
    await app.inject({ method: "POST", url: "/users/me/deletion-request", headers: auth(accessToken) });

    const relogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "delete2@example.com", password: "somepassword" },
    });
    expect(relogin.statusCode).toBe(200);
    const newAccessToken = relogin.json().accessToken as string;

    const cancelRes = await app.inject({
      method: "POST",
      url: "/users/me/deletion-cancel",
      headers: auth(newAccessToken),
    });
    expect(cancelRes.statusCode).toBe(200);

    const profile = await app.inject({ method: "GET", url: "/users/me", headers: auth(newAccessToken) });
    expect(profile.json().scheduledDeletionAt).toBeNull();
  });
});

describe("GET /users/me/export", () => {
  it("returns the profile without password_hash", async () => {
    const { accessToken } = await signupAndLogin("export1@example.com");
    const res = await app.inject({ method: "GET", url: "/users/me/export", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.email).toBe("export1@example.com");
    expect(body.profile).not.toHaveProperty("passwordHash");
    expect(body).toHaveProperty("memberships");
    expect(body).toHaveProperty("picks");
  });
});

describe("GET /users/me/results-digest", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/users/me/results-digest" });
    expect(res.statusCode).toBe(401);
  });

  it("returns yesterday's record for a league with graded games, and omits a league with none", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const leagueWithGames = await createTestLeague(aliceUser.id, { name: "AFC League", timezone: "UTC" });
    const alice = await createTestLeagueMember(aliceUser.id, leagueWithGames.id, { role: "commissioner" });

    const yesterday = DateTime.now().setZone("UTC").minus({ days: 1 }).toISODate()!;
    const yesterdayAt = (hour: number) => DateTime.fromISO(yesterday, { zone: "UTC" }).set({ hour }).toJSDate();

    const g1 = await createTestGame({ startsAt: yesterdayAt(18) });
    const g2 = await createTestGame({ startsAt: yesterdayAt(20) });
    await gradePick((await createTestPick(alice.id, g1.id)).id, "win");
    await gradePick((await createTestPick(alice.id, g2.id)).id, "loss");

    // A second league the caller belongs to, but with no games at all
    // yesterday — must be omitted from the response entirely, not
    // returned with zeros.
    const leagueNoGames = await createTestLeague(aliceUser.id, { name: "Quiet League", timezone: "UTC" });
    await createTestLeagueMember(aliceUser.id, leagueNoGames.id, { role: "commissioner" });

    const token = await tokenFor(aliceUser.id);
    const res = await app.inject({ method: "GET", url: "/users/me/results-digest", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0]).toMatchObject({
      leagueId: leagueWithGames.id,
      leagueName: "AFC League",
      date: yesterday,
      wins: 1,
      losses: 1,
      gamesParticipated: 2,
      rank: 1,
    });
  });

  it("resolves 'yesterday' independently per league, in that league's own timezone", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });

    const tzA = "America/Chicago";
    const leagueA = await createTestLeague(aliceUser.id, { name: "Chicago League", timezone: tzA });
    const memberA = await createTestLeagueMember(aliceUser.id, leagueA.id, { role: "commissioner" });
    const todayA = DateTime.now().setZone(tzA).toISODate()!;
    const yesterdayA = DateTime.fromISO(todayA, { zone: tzA }).minus({ days: 1 }).toISODate()!;
    const gameA = await createTestGame({ startsAt: DateTime.fromISO(yesterdayA, { zone: tzA }).set({ hour: 12 }).toJSDate() });
    await gradePick((await createTestPick(memberA.id, gameA.id)).id, "win");

    const tzB = "Pacific/Auckland";
    const leagueB = await createTestLeague(aliceUser.id, { name: "Auckland League", timezone: tzB });
    const memberB = await createTestLeagueMember(aliceUser.id, leagueB.id, { role: "commissioner" });
    const todayB = DateTime.now().setZone(tzB).toISODate()!;
    const yesterdayB = DateTime.fromISO(todayB, { zone: tzB }).minus({ days: 1 }).toISODate()!;
    const gameB = await createTestGame({ startsAt: DateTime.fromISO(yesterdayB, { zone: tzB }).set({ hour: 12 }).toJSDate() });
    await gradePick((await createTestPick(memberB.id, gameB.id)).id, "loss");

    const token = await tokenFor(aliceUser.id);
    const res = await app.inject({ method: "GET", url: "/users/me/results-digest", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const byLeague = new Map(
      (res.json().leagues as Array<{ leagueId: string; date: string }>).map((l) => [l.leagueId, l]),
    );
    expect(byLeague.get(leagueA.id)?.date).toBe(yesterdayA);
    expect(byLeague.get(leagueB.id)?.date).toBe(yesterdayB);
  });

  it("multiple leagues with graded games are all returned, sorted by league name", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const yesterday = DateTime.now().setZone("UTC").minus({ days: 1 }).toISODate()!;
    const yesterdayAt = (hour: number) => DateTime.fromISO(yesterday, { zone: "UTC" }).set({ hour }).toJSDate();

    const leagueZ = await createTestLeague(aliceUser.id, { name: "Zeta League", timezone: "UTC" });
    const memberZ = await createTestLeagueMember(aliceUser.id, leagueZ.id, { role: "commissioner" });
    await gradePick((await createTestPick(memberZ.id, (await createTestGame({ startsAt: yesterdayAt(10) })).id)).id, "win");

    const leagueA = await createTestLeague(aliceUser.id, { name: "Alpha League", timezone: "UTC" });
    const memberA = await createTestLeagueMember(aliceUser.id, leagueA.id, { role: "commissioner" });
    await gradePick((await createTestPick(memberA.id, (await createTestGame({ startsAt: yesterdayAt(11) })).id)).id, "loss");

    const token = await tokenFor(aliceUser.id);
    const res = await app.inject({ method: "GET", url: "/users/me/results-digest", headers: auth(token) });

    expect(res.statusCode).toBe(200);
    const names = (res.json().leagues as Array<{ leagueName: string }>).map((l) => l.leagueName);
    expect(names).toEqual(["Alpha League", "Zeta League"]);
  });

  it("returns an empty leagues array for a caller in no leagues", async () => {
    const { accessToken } = await signupAndLogin("nodigest@example.com");
    const res = await app.inject({ method: "GET", url: "/users/me/results-digest", headers: auth(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ leagues: [] });
  });
});
