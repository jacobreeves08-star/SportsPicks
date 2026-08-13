import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { emitSessionExpired, resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import { createAppRouter } from "./route-tree.js";
import { startSessionExpiryRedirect } from "./session-redirect.js";

beforeEach(() => {
  resetAuthStoreForTests();
});

describe("startSessionExpiryRedirect", () => {
  it("navigates to /login with returnTo set to the current location on session expiry", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/leagues/league-1/slate/2026-08-13"] }));
    await router.load();
    startSessionExpiryRedirect(router);

    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    emitSessionExpired();
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    const match = router.state.matches.find((m) => m.routeId === "/login");
    expect(match?.search).toEqual({ returnTo: "/leagues/league-1/slate/2026-08-13" });
  });

  it("stops redirecting after the returned unsubscribe function is called", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/leagues/league-1/standings"] }));
    await router.load();
    const stop = startSessionExpiryRedirect(router);
    stop();

    emitSessionExpired();
    await router.load();

    expect(router.state.location.pathname).toBe("/leagues/league-1/standings"); // unchanged
  });
});
