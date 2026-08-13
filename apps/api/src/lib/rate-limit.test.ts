import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { createSession } from "./session.js";

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
 * Per-account rate limiting (JAC-43-48) — distinct from the existing
 * IP-keyed global limit (app.ts, 100/min), which an authenticated
 * account hammering from rotating IPs would never trip. Exercises the
 * REAL configured default (ACCOUNT_RATE_LIMIT_PER_MINUTE=300), not an
 * artificially lowered test-only value, matching this codebase's
 * existing rate-limit test style (auth.routes.test.ts's signup test
 * hits the real 5/min limit).
 *
 * `x-forwarded-for` varies on every request below (app.ts sets
 * `trustProxy: true`, so this changes what `request.ip` resolves to) —
 * without that, the pre-existing GLOBAL 100/min IP-keyed limit trips
 * first at request ~101, from the same fake app.inject() IP, and this
 * test would only ever prove the global limit exists, not the new
 * per-account one. Varying the apparent IP every request means the
 * global IP-keyed limiter never accumulates past 1 for any single IP,
 * so the per-account limiter is the only one that CAN bind here.
 */
describe("account-wide rate limit (JAC-43-48)", () => {
  it(
    "limits one account after its per-minute budget, even as its apparent IP changes every request",
    async () => {
      const user = await createTestUser();
      const token = await tokenFor(user.id);

      let lastStatus = 200;
      let lastBody: unknown;
      for (let i = 0; i < 301; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/users/me",
          headers: { ...auth(token), "x-forwarded-for": `10.0.${Math.floor(i / 255)}.${i % 255}` },
        });
        lastStatus = res.statusCode;
        lastBody = res.json();
      }

      expect(lastStatus).toBe(429);
      expect((lastBody as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
      expect(typeof (lastBody as { error: { retryAfterSeconds: number } }).error.retryAfterSeconds).toBe("number");

      // A different account, using a fresh apparent IP never seen above,
      // has its own independent budget — proves no cross-account bleed.
      const other = await createTestUser();
      const otherToken = await tokenFor(other.id);
      const otherRes = await app.inject({
        method: "GET",
        url: "/users/me",
        headers: { ...auth(otherToken), "x-forwarded-for": "10.99.99.99" },
      });
      expect(otherRes.statusCode).toBe(200);
    },
    30_000,
  );
});
