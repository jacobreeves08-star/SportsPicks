import { useSyncExternalStore } from "react";
import { getAuthState, subscribeToAuth, type StoredAuthState } from "./auth-store.js";

/**
 * React's view of `auth-store.ts` — the first call site
 * `subscribeToAuth` has ever had (it was built alongside the store but
 * nothing needed to REACT to auth state until `/` became a route that
 * renders two different things depending on it).
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect`
 * subscription: the store is mutated from outside React entirely (the
 * fetch client's token refresh, a session expiring during a background
 * poll), and this is exactly the case that hook exists for — it can't
 * tear between a render that read the token and a concurrent update
 * that cleared it.
 *
 * Safe as a snapshot because `getAuthState()` returns the store's own
 * state object, which is REPLACED (never mutated in place) on every
 * change — so its identity is stable between changes, which is what
 * `useSyncExternalStore` requires to avoid an infinite render loop.
 */
export function useAuthState(): StoredAuthState {
  return useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState);
}

export function useIsAuthenticated(): boolean {
  return Boolean(useAuthState().accessToken);
}
