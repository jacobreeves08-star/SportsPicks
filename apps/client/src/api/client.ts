import { recordClockSync } from "../time/server-clock.js";
import { emitSessionExpired, getAuthState, setAuthTokens } from "./auth-store.js";
import { API_BASE_URL } from "./config.js";
import { ApiError, networkError, parseError, type ApiErrorBody } from "./errors.js";
import type { AuthTokens } from "./types.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Attach `Authorization: Bearer <accessToken>`. Default true. Set
   * false for the handful of routes that run before a session exists
   * (signup, login, refresh, password-reset) — see
   * docs/client-api-contract.md's endpoint catalog for exactly which. */
  auth?: boolean;
  /** Internal recursion guard — set automatically on the single retry
   * after a successful token refresh, so a request that somehow gets
   * UNAUTHENTICATED *again* (token revoked mid-flight, a genuine edge
   * case) fails cleanly instead of refreshing forever. Application
   * code should never set this. */
  skipRefreshOnUnauthenticated?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * The one place a `fetch` call happens in this app. Every response —
 * success or error — has its `X-Server-Time` header fed into the
 * server-clock module (Step 3), bracketed by this device's own
 * `Date.now()` readings taken immediately before the network call and
 * immediately after the response arrives, which is what makes the
 * NTP-style round-trip correction in `server-clock.ts` possible. A
 * malformed/missing header never breaks the actual request — clock
 * sync is a side effect of a request, never a precondition for one.
 */
async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  const requestStartedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw networkError(err);
  }
  const responseReceivedAt = Date.now();

  const serverTime = response.headers.get("x-server-time");
  if (serverTime) {
    try {
      recordClockSync(serverTime, requestStartedAt, responseReceivedAt);
    } catch {
      // Malformed value from a misbehaving intermediary — the request
      // itself still succeeded or failed on its own merits; don't let
      // a clock-sync parse error masquerade as a request failure.
    }
  }

  return response;
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

/**
 * Session-expiry contract (docs/api-conventions.md, implemented here —
 * this is the one place it's implemented, not duplicated per screen):
 * on UNAUTHENTICATED, attempt exactly one `/auth/refresh`; if that
 * fails, the session is genuinely dead.
 *
 * Concurrent 401s share ONE in-flight refresh call, not one each — a
 * burst of parallel requests hitting expiry simultaneously (e.g.
 * several queries refetching together on tab focus) must not race N
 * separate refresh attempts against the same, single-use refresh
 * token: the API rotates it on use, so every attempt after the first
 * would fail against an already-rotated-away token, turning one
 * legitimate expiry into a spurious full logout.
 */
async function refreshSession(): Promise<AuthTokens | null> {
  const { refreshToken } = getAuthState();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await rawFetch(buildUrl("/auth/refresh"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return null;
        const tokens = (await response.json()) as AuthTokens;
        setAuthTokens(tokens);
        return tokens;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

/** Typed API call against the documented contract
 * (docs/client-api-contract.md). Throws `ApiError` for every non-2xx
 * response, every network failure, and every unparseable body — see
 * api/errors.ts. `T` is the caller's expected response shape; nothing
 * here validates it against the wire response beyond "valid JSON" —
 * see api/endpoints.ts for the typed, endpoint-specific wrappers this
 * is meant to be used through rather than called directly per screen. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true, skipRefreshOnUnauthenticated = false } = options;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const { accessToken } = getAuthState();
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  }

  const response = await rawFetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 No Content (league delete, remove-member) has no body to parse.
  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw parseError(response.status, err);
  }

  if (!response.ok) {
    const rawError = (payload as { error?: unknown } | null)?.error;
    const errorBody: ApiErrorBody =
      rawError && typeof rawError === "object" && "code" in rawError && "message" in rawError
        ? (rawError as ApiErrorBody)
        : { code: "REQUEST_ERROR", message: "Request failed" };

    const apiError = new ApiError(errorBody, response.status);

    if (apiError.code === "UNAUTHENTICATED" && auth && !skipRefreshOnUnauthenticated) {
      const refreshed = await refreshSession();
      if (refreshed) {
        // Retry the ORIGINAL request exactly once, now with the fresh
        // token — never retried a second time (skipRefreshOnUnauthenticated
        // guards that).
        return apiFetch<T>(path, { ...options, skipRefreshOnUnauthenticated: true });
      }
      // Refresh itself failed (no refresh token stored, or the server
      // rejected it) — the session is genuinely over. Clears stored
      // tokens and notifies subscribers (the router's login-redirect
      // logic — Step 8) so this doesn't happen silently.
      emitSessionExpired();
    }

    throw apiError;
  }

  return payload as T;
}
