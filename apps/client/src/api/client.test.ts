import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthTokens, getAuthState, onSessionExpired, resetAuthStoreForTests, setAuthTokens } from "./auth-store.js";
import { apiFetch } from "./client.js";
import { getClockSync, resetClockSyncForTests } from "../time/server-clock.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-server-time": "2026-08-13T12:00:00.000Z", ...headers },
  });
}

beforeEach(() => {
  resetAuthStoreForTests();
  resetClockSyncForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch — happy path", () => {
  it("returns the parsed JSON body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { hello: "world" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ hello: string }>("/health");
    expect(result).toEqual({ hello: "world" });
  });

  it("returns undefined for a 204 with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204, headers: { "x-server-time": "2026-08-13T12:00:00.000Z" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch("/leagues/abc/members/def");
    expect(result).toBeUndefined();
  });

  it("attaches the Authorization header when auth is true (default) and a token is stored", async () => {
    setAuthTokens({ accessToken: "at-1", refreshToken: "rt-1" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/users/me");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at-1");
  });

  it("does not attach an Authorization header when auth is false", async () => {
    setAuthTokens({ accessToken: "at-1", refreshToken: "rt-1" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/signup", { method: "POST", auth: false, body: { email: "a@example.com" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("records a clock sync sample from X-Server-Time on a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    expect(getClockSync()).toBeNull();
    await apiFetch("/health");
    expect(getClockSync()).not.toBeNull();
  });
});

describe("apiFetch — error handling", () => {
  it("throws ApiError with the code/message/fields from the envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "Request failed validation", fields: [{ field: "email", message: "required" }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/leagues", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request failed validation",
      fields: [{ field: "email", message: "required" }],
      status: 400,
    });
  });

  it("records the clock sync sample on an error response too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: { code: "NOT_FOUND", message: "Route not found" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/nope")).rejects.toThrow();
    expect(getClockSync()).not.toBeNull();
  });

  it("wraps a network-level fetch failure as a NETWORK_ERROR with status 0", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/health")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("wraps an unparseable body as a PARSE_ERROR carrying the real HTTP status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>not json</html>", { status: 502, headers: { "x-server-time": "2026-08-13T12:00:00.000Z" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/health")).rejects.toMatchObject({ code: "PARSE_ERROR", status: 502 });
  });

  it("retryAfterSeconds survives onto the thrown ApiError for a 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(429, { error: { code: "RATE_LIMITED", message: "Rate limit exceeded, retry in 12 seconds", retryAfterSeconds: 12 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/leagues")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 12 });
  });
});

describe("apiFetch — session-expiry contract", () => {
  it("on UNAUTHENTICATED, refreshes once and retries the original request with the new token", async () => {
    setAuthTokens({ accessToken: "stale-at", refreshToken: "rt-1" });

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/auth/refresh") {
        return jsonResponse(200, {
          accessToken: "fresh-at",
          refreshToken: "fresh-rt",
          accessTokenExpiresAt: "2026-08-13T12:15:00.000Z",
          refreshTokenExpiresAt: "2026-11-11T12:00:00.000Z",
        });
      }
      // /users/me: first call (stale token) rejects, retry (fresh token) succeeds.
      return fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname === "/users/me").length === 1
        ? jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required" } })
        : jsonResponse(200, { id: "user-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ id: string }>("/users/me");

    expect(result).toEqual({ id: "user-1" });
    expect(getAuthState().accessToken).toBe("fresh-at");
    // /users/me called twice (original + one retry), /auth/refresh called once.
    const meCalls = fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname === "/users/me");
    const refreshCalls = fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname === "/auth/refresh");
    expect(meCalls).toHaveLength(2);
    expect(refreshCalls).toHaveLength(1);
  });

  it("when refresh itself fails, clears tokens, emits session-expired, and throws the original UNAUTHENTICATED error", async () => {
    setAuthTokens({ accessToken: "stale-at", refreshToken: "dead-rt" });

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/auth/refresh") {
        return jsonResponse(401, { error: { code: "INVALID_REFRESH_TOKEN", message: "Invalid or expired refresh token" } });
      }
      return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sessionExpired = vi.fn();
    onSessionExpired(sessionExpired);

    await expect(apiFetch("/users/me")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    expect(sessionExpired).toHaveBeenCalledTimes(1);
    expect(getAuthState()).toEqual({ accessToken: null, refreshToken: null });
  });

  it("never attempts a refresh loop beyond one retry, even if the retried request is UNAUTHENTICATED again", async () => {
    setAuthTokens({ accessToken: "stale-at", refreshToken: "rt-1" });

    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/auth/refresh") {
        return jsonResponse(200, {
          accessToken: "fresh-at",
          refreshToken: "fresh-rt",
          accessTokenExpiresAt: "2026-08-13T12:15:00.000Z",
          refreshTokenExpiresAt: "2026-11-11T12:00:00.000Z",
        });
      }
      // Always 401, even after refresh — simulates a token revoked mid-flight.
      return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/users/me")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const refreshCalls = fetchMock.mock.calls.filter((c) => new URL(c[0] as string).pathname === "/auth/refresh");
    // Exactly one refresh attempt — no infinite loop.
    expect(refreshCalls).toHaveLength(1);
  });

  it("concurrent 401s share a single in-flight refresh call, not one each", async () => {
    setAuthTokens({ accessToken: "stale-at", refreshToken: "rt-1" });

    let refreshCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/auth/refresh") {
        refreshCallCount += 1;
        return jsonResponse(200, {
          accessToken: "fresh-at",
          refreshToken: "fresh-rt",
          accessTokenExpiresAt: "2026-08-13T12:15:00.000Z",
          refreshTokenExpiresAt: "2026-11-11T12:00:00.000Z",
        });
      }
      const headers = init?.headers as Record<string, string> | undefined;
      const usedFreshToken = headers?.authorization === "Bearer fresh-at";
      return usedFreshToken ? jsonResponse(200, { ok: true }) : jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Two independent requests both start with the stale token and both 401 "simultaneously".
    await Promise.all([apiFetch("/users/me"), apiFetch("/leagues")]);

    expect(refreshCallCount).toBe(1);
  });
});

describe("clearAuthTokens", () => {
  it("does not fire the session-expired listener (that's only for the involuntary refresh-failure path)", () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const sessionExpired = vi.fn();
    onSessionExpired(sessionExpired);

    clearAuthTokens();

    expect(sessionExpired).not.toHaveBeenCalled();
    expect(getAuthState()).toEqual({ accessToken: null, refreshToken: null });
  });
});
