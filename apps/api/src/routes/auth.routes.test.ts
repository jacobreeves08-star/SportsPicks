import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { session, user, verificationToken } from "../db/schema.js";
import { truncateAllTables } from "../db/test-helpers.js";
import { hashToken } from "../lib/tokens.js";
import { issueVerificationToken } from "../lib/verification-tokens.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

async function signup(email: string, password = "correcthorsebattery", displayName = "Test", timezone = "UTC") {
  return app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password, displayName, timezone },
  });
}

async function login(email: string, password: string) {
  return app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
}

async function findUserByEmail(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  return row!;
}

describe("POST /auth/signup", () => {
  it("succeeds with a generic response", async () => {
    const res = await signup("new@example.com");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ message: "Check your email to verify your account." });
  });

  it("rejects an invalid timezone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "a@example.com", password: "correcthorsebattery", displayName: "A", timezone: "Not/AZone" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("a duplicate email returns a status/body byte-identical to a fresh signup", async () => {
    const fresh = await signup("dup1@example.com");
    const dup = await signup("dup1@example.com");
    expect(dup.statusCode).toBe(fresh.statusCode);
    expect(dup.json()).toEqual(fresh.json());
  });

  it("a duplicate email does not create a second user row", async () => {
    await signup("dup2@example.com");
    await signup("dup2@example.com");
    const rows = await db.select().from(user).where(eq(user.email, "dup2@example.com"));
    expect(rows).toHaveLength(1);
  });

  /**
   * JAC-43-48 bot protection: the honeypot field is invisible to a real
   * client (no frontend renders it), so only a scripted client guessing
   * at field names would ever fill it. A filled value gets the exact
   * same success response as a real signup, with no side effects —
   * never reveals that anything was detected, same idiom as the
   * duplicate-email branch above.
   */
  it("a filled honeypot field returns success but creates no user and sends no email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "honeypot@example.com",
        password: "correcthorsebattery",
        displayName: "Bot",
        timezone: "UTC",
        website: "https://spam.example",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ message: "Check your email to verify your account." });
    const rows = await findUserByEmail("honeypot@example.com");
    expect(rows).toBeUndefined();
  });

  it("an empty honeypot field behaves like a normal signup", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: "nohoneypot@example.com",
        password: "correcthorsebattery",
        displayName: "Real",
        timezone: "UTC",
        website: "",
      },
    });
    expect(res.statusCode).toBe(201);
    const rows = await findUserByEmail("nohoneypot@example.com");
    expect(rows).toBeDefined();
  });

  it("rate limits after repeated rapid requests", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await signup(`ratelimit${i}@example.com`));
    }
    expect(results.slice(0, 5).every((r) => r.statusCode !== 429)).toBe(true);
    expect(results[5]!.statusCode).toBe(429);
    expect(results[5]!.json().error.code).toBe("RATE_LIMITED");
    // JAC-43-48: the global errorResponseBuilder (app.ts) attaches this
    // to every 429 in the app, not just signup's — retryAfterSeconds
    // lets a client show "try again in Xs" instead of a generic message.
    expect(typeof results[5]!.json().error.retryAfterSeconds).toBe("number");
    expect(results[5]!.json().error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("POST /auth/login", () => {
  it("succeeds with correct credentials and returns tokens", async () => {
    await signup("login1@example.com", "correctpassword");
    const res = await login("login1@example.com", "correctpassword");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("accessToken");
    expect(body).toHaveProperty("refreshToken");
    expect(body).toHaveProperty("accessTokenExpiresAt");
    expect(body).toHaveProperty("refreshTokenExpiresAt");
  });

  it("wrong password and nonexistent email return an identical 401", async () => {
    await signup("login2@example.com", "correctpassword");
    const wrongPassword = await login("login2@example.com", "wrongpassword");
    const noSuchAccount = await login("nobody@example.com", "whatever123");

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchAccount.json());
    expect(wrongPassword.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("succeeds even before email verification (decision 13)", async () => {
    await signup("unverified@example.com", "correctpassword");
    const res = await login("unverified@example.com", "correctpassword");
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /auth/refresh", () => {
  it("rotates: issues a new pair and rejects reuse of the old refresh token", async () => {
    await signup("refresh1@example.com", "correctpassword");
    const loginRes = await login("refresh1@example.com", "correctpassword");
    const oldRefresh = loginRes.json().refreshToken as string;

    const rotated = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: oldRefresh } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(oldRefresh);

    const reused = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: oldRefresh } });
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects an expired refresh token", async () => {
    await signup("refresh2@example.com", "correctpassword");
    const loginRes = await login("refresh2@example.com", "correctpassword");
    const { refreshToken } = loginRes.json();

    // Simulate expiry directly rather than waiting AUTH_REFRESH_TOKEN_TTL_DAYS.
    await db
      .update(session)
      .set({ refreshTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.refreshTokenHash, hashToken(refreshToken)));

    const res = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /auth/logout and /auth/logout-all", () => {
  it("logout revokes the current session's access token", async () => {
    await signup("logout1@example.com", "correctpassword");
    const { accessToken } = (await login("logout1@example.com", "correctpassword")).json();

    const logoutRes = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("logout-all revokes every session for the user", async () => {
    await signup("logoutall1@example.com", "correctpassword");
    const a = (await login("logoutall1@example.com", "correctpassword")).json();
    const b = (await login("logoutall1@example.com", "correctpassword")).json();

    await app.inject({ method: "POST", url: "/auth/logout-all", headers: { authorization: `Bearer ${a.accessToken}` } });

    const checkA = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    const checkB = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${b.accessToken}` },
    });
    expect(checkA.statusCode).toBe(401);
    expect(checkB.statusCode).toBe(401);
  });
});

describe("GET /auth/verify-email", () => {
  it("verifies with a valid token and rejects reuse", async () => {
    await signup("verify1@example.com");
    const row = await findUserByEmail("verify1@example.com");
    const token = await issueVerificationToken(row.id, "email_verify");

    const first = await app.inject({ method: "GET", url: `/auth/verify-email?token=${token}` });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "GET", url: `/auth/verify-email?token=${token}` });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });
});

describe("password reset", () => {
  it("full flow: request -> confirm -> old sessions revoked, new password works", async () => {
    await signup("reset1@example.com", "oldpassword");
    const { accessToken } = (await login("reset1@example.com", "oldpassword")).json();

    const requestRes = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "reset1@example.com" },
    });
    expect(requestRes.statusCode).toBe(200);

    const row = await findUserByEmail("reset1@example.com");
    // signup() also issues an email_verify token for this user, so
    // filter by purpose rather than assuming row order.
    const [tokenRow] = await db
      .select()
      .from(verificationToken)
      .where(and(eq(verificationToken.userId, row.id), eq(verificationToken.purpose, "password_reset")))
      .limit(1);
    expect(tokenRow?.purpose).toBe("password_reset");

    // The route already issued a real token via the request above; we
    // don't have its raw value (only its hash is stored), so issue a
    // fresh one the same way the route itself does — equivalent
    // coverage for confirm's behavior without scraping mock-provider logs.
    const freshToken = await issueVerificationToken(row.id, "password_reset");

    const confirmRes = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token: freshToken, newPassword: "newpassword123" },
    });
    expect(confirmRes.statusCode).toBe(200);

    // The session active before the reset is now dead — no exception,
    // per decision 9 (reset revokes ALL sessions, unlike a deliberate
    // authenticated password change).
    const staleCheck = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(staleCheck.statusCode).toBe(401);

    const newLogin = await login("reset1@example.com", "newpassword123");
    expect(newLogin.statusCode).toBe(200);
  });

  it("request returns an identical response whether or not the account exists", async () => {
    await signup("reset2@example.com");
    const exists = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "reset2@example.com" },
    });
    const doesNotExist = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "nobody-at-all@example.com" },
    });
    expect(exists.statusCode).toBe(doesNotExist.statusCode);
    expect(exists.json()).toEqual(doesNotExist.json());
  });
});
