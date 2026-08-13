import { onSessionExpired } from "../api/auth-store.js";
import type { AppRouter } from "./route-tree.js";

/**
 * The other half of the session-expiry contract
 * (docs/api-conventions.md, docs/client-api-contract.md): when
 * api/client.ts exhausts a refresh attempt and calls
 * `emitSessionExpired()`, this is what actually navigates to `/login`
 * carrying `?returnTo=<path the user was on>` — the router-side
 * consumer of that event, kept separate from api/client.ts itself so
 * the API layer has no dependency on the router (api/client.ts is
 * reused by the offline queue and mutation hooks, none of which
 * should need to know a router even exists).
 *
 * Call once at app startup with the app's router instance (see
 * main.tsx); returns an unsubscribe function for symmetry with every
 * other `on*` subscription in this codebase, though in practice this
 * runs for the app's whole lifetime.
 */
export function startSessionExpiryRedirect(router: AppRouter): () => void {
  return onSessionExpired(() => {
    const returnTo = router.state.location.href;
    void router.navigate({ to: "/login", search: { returnTo } });
  });
}
