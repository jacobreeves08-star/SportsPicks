import type { AuthTokens } from "./types.js";

/**
 * Token storage + the "session died" signal. `localStorage`-backed so
 * a page reload doesn't force a re-login — deliberately NOT a cookie
 * (this API is Bearer-token-only by design, docs/adr/0002 — see
 * docs/client-api-contract.md).
 *
 * Kept as a tiny standalone store (not React state) on purpose: the
 * fetch client (api/client.ts) needs synchronous read access to the
 * current access token on every request, including requests that
 * happen outside any React render (a background retry, the offline
 * queue flushing) — routing that through a React context/hook would
 * force every one of those call sites to somehow be "inside" a
 * component tree. `subscribeToAuth` is how React code (a route guard,
 * a top-level provider) observes it without owning it.
 */
export interface StoredAuthState {
  accessToken: string | null;
  refreshToken: string | null;
}

const STORAGE_KEY = "sports-pickem:auth";

function readFromStorage(): StoredAuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "accessToken" in parsed &&
      "refreshToken" in parsed
    ) {
      const { accessToken, refreshToken } = parsed as Record<string, unknown>;
      return {
        accessToken: typeof accessToken === "string" ? accessToken : null,
        refreshToken: typeof refreshToken === "string" ? refreshToken : null,
      };
    }
    return { accessToken: null, refreshToken: null };
  } catch {
    // Corrupt/unavailable storage (private browsing, quota, a hand-
    // edited value) — treat exactly like "never logged in," never
    // throw out of a module load.
    return { accessToken: null, refreshToken: null };
  }
}

let state: StoredAuthState = typeof localStorage !== "undefined" ? readFromStorage() : { accessToken: null, refreshToken: null };
const listeners = new Set<(state: StoredAuthState) => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable/full — in-memory state is still correct for
     * the rest of this session; just won't survive a reload. */
  }
  for (const listener of listeners) listener(state);
}

export function getAuthState(): StoredAuthState {
  return state;
}

export function setAuthTokens(tokens: Pick<AuthTokens, "accessToken" | "refreshToken">): void {
  state = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  persist();
}

/** Called on logout, on deletion-request (which server-side revokes
 * every session including the caller's own — see
 * docs/client-api-contract.md), and when a refresh attempt itself
 * fails (the session is genuinely dead, not just due for a refresh). */
export function clearAuthTokens(): void {
  state = { accessToken: null, refreshToken: null };
  persist();
}

export function subscribeToAuth(listener: (state: StoredAuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fired specifically when the API client (api/client.ts) exhausts the
 * session-expiry contract — a 401, then a failed refresh attempt —
 * NOT on an intentional logout (`clearAuthTokens()` alone covers
 * that). Distinct from `subscribeToAuth` so the router can react only
 * to the involuntary case: capture `?returnTo=<current path>` and
 * navigate to login, per docs/api-conventions.md's documented client
 * contract. A deliberate logout needs no such redirect capture — the
 * user chose to leave.
 */
const sessionExpiredListeners = new Set<() => void>();

export function emitSessionExpired(): void {
  clearAuthTokens();
  for (const listener of sessionExpiredListeners) listener();
}

export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

/** Test-only reset — never call from application code. */
export function resetAuthStoreForTests(): void {
  state = { accessToken: null, refreshToken: null };
  listeners.clear();
  sessionExpiredListeners.clear();
}
