import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitSessionExpired, resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import { createAppRouter } from "./route-tree.js";
import { startSessionExpiryRedirect } from "./session-redirect.js";

beforeEach(() => {
  resetAuthStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startSessionExpiryRedirect", () => {
  it("navigates to /login with returnTo set to the current location on session expiry", async () => {
    // The real scenario this covers: a logged-in user, mid-slate,
    // whose session dies (Epic 10 brief: "the worst possible moment,
    // mid-slate before a lock") — so tokens must be set BEFORE the
    // first load, or authenticatedLayoutRoute's own guard would
    // already have redirected to /login before emitSessionExpired
    // ever fires, which would make this test assert the wrong thing.
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/leagues/league-1/slate/2026-08-13"] }));
    await router.load();
    startSessionExpiryRedirect(router);

    emitSessionExpired();
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    const match = router.state.matches.find((m) => m.routeId === "/login");
    expect(match?.search).toEqual({ returnTo: "/leagues/league-1/slate/2026-08-13" });
  });

  it("stops calling router.navigate after the returned unsubscribe function is called", async () => {
    // Asserting on `router.navigate` directly, not on the eventual
    // location, because `authenticatedLayoutRoute`'s own guard
    // (route-tree.tsx) is now an INDEPENDENT second layer that would
    // also redirect to /login on any subsequent `router.load()` once
    // `emitSessionExpired()` clears the access token — regardless of
    // whether this module's own listener is still subscribed. That's
    // correct, desirable defense in depth, but it means "the URL
    // didn't change" is no longer a valid way to prove THIS module
    // stopped acting — spying on the call directly is unambiguous.
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/leagues/league-1/standings"] }));
    await router.load();
    const navigateSpy = vi.spyOn(router, "navigate");
    const stop = startSessionExpiryRedirect(router);
    stop();

    emitSessionExpired();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
