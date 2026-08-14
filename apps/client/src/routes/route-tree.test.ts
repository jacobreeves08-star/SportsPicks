import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import * as endpoints from "../api/endpoints.js";
import { getCachedSlateDate, resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { createAppRouter } from "./route-tree.js";

function routerAt(path: string) {
  return createAppRouter(createMemoryHistory({ initialEntries: [path] }));
}

function loginAsTestUser(): void {
  setAuthTokens({ accessToken: "test-access-token", refreshToken: "test-refresh-token" });
}

beforeEach(() => {
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  localStorage.clear();
});

afterEach(() => {
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("route-tree — the auth guard (authenticatedLayoutRoute)", () => {
  it("redirects an unauthenticated visitor to /login with the original path+query as returnTo", async () => {
    const router = routerAt("/leagues/league-1/standings?range=week");
    await router.load();

    expect(router.state.location.pathname).toBe("/login");
    const match = router.state.matches.find((m) => m.routeId === "/login");
    expect(match?.search).toEqual({ returnTo: "/leagues/league-1/standings?range=week" });
  });

  it("does NOT redirect an authenticated visitor", async () => {
    loginAsTestUser();
    const router = routerAt("/leagues/league-1/standings");
    await router.load();

    expect(router.state.location.pathname).toBe("/leagues/league-1/standings");
  });

  it("guards the home route the same way", async () => {
    const router = routerAt("/");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("guards the profile route the same way", async () => {
    const router = routerAt("/profile");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("does NOT guard /login or /join — a logged-out visitor can still reach them", async () => {
    const router = routerAt("/join/ABC123");
    await router.load();
    expect(router.state.location.pathname).toBe("/join/ABC123");
  });
});

describe("route-tree — deep link resolution (authenticated)", () => {
  beforeEach(() => {
    loginAsTestUser();
  });

  it("resolves /leagues/:leagueId/slate/:date with typed path params", async () => {
    const router = routerAt("/leagues/league-1/slate/2026-08-13");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/$leagueId/slate/$date");
    expect(match?.params).toEqual({ leagueId: "league-1", date: "2026-08-13" });
  });

  it("resolves /leagues/:leagueId/standings with the default range when no query string is present", async () => {
    const router = routerAt("/leagues/league-1/standings");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/$leagueId/standings");
    expect(match?.params).toEqual({ leagueId: "league-1" });
    expect(match?.search).toEqual({ range: "today" });
  });

  it("resolves an explicit ?range=week", async () => {
    const router = routerAt("/leagues/league-1/standings?range=week");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/$leagueId/standings");
    expect(match?.search).toEqual({ range: "week" });
  });

  it("falls back to the default range for an invalid value, rather than erroring", async () => {
    const router = routerAt("/leagues/league-1/standings?range=bogus");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/$leagueId/standings");
    expect(match?.search).toEqual({ range: "today" });
  });

  it("resolves /leagues/:leagueId/head-to-head/:date with typed path params", async () => {
    const router = routerAt("/leagues/league-1/head-to-head/2026-08-13");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/$leagueId/head-to-head/$date");
    expect(match?.params).toEqual({ leagueId: "league-1", date: "2026-08-13" });
  });

  it("resolves the home route", async () => {
    const router = routerAt("/");
    await router.load();
    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/");
    expect(match).toBeDefined();
  });

  it("resolves the profile route", async () => {
    const router = routerAt("/profile");
    await router.load();
    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/profile");
    expect(match).toBeDefined();
  });

  it("guards the create-league route the same way, ahead of the dynamic /leagues/:leagueId route", async () => {
    const router = routerAt("/leagues/new");
    await router.load();
    const match = router.state.matches.find((m) => m.routeId === "/_authenticated/leagues/new");
    expect(match).toBeDefined();
  });

  it("resolves /join/:inviteCode with the invite code as a path param", async () => {
    const router = routerAt("/join/ABC123");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/join/$inviteCode");
    expect(match?.params).toEqual({ inviteCode: "ABC123" });
  });

  it("redirects the backend's actual /join?code=XXXX shape to the canonical /join/:inviteCode", async () => {
    const router = routerAt("/join?code=ABC123");
    await router.load();

    expect(router.state.location.pathname).toBe("/join/ABC123");
    const match = router.state.matches.find((m) => m.routeId === "/join/$inviteCode");
    expect(match?.params).toEqual({ inviteCode: "ABC123" });
  });

  it("resolves /login with an empty returnTo when none is given", async () => {
    const router = routerAt("/login");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/login");
    expect(match?.search).toEqual({ returnTo: undefined });
  });

  it("resolves /login?returnTo=<path> with the path preserved exactly", async () => {
    const router = routerAt("/login?returnTo=%2Fleagues%2Fleague-1%2Fslate%2F2026-08-13");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/login");
    expect(match?.search).toEqual({ returnTo: "/leagues/league-1/slate/2026-08-13" });
  });

  it("resolves /signup?returnTo=<path> the same way — the join deep-link flow depends on this", async () => {
    const router = routerAt("/signup?returnTo=%2Fjoin%2FABC123");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/signup");
    expect(match?.search).toEqual({ returnTo: "/join/ABC123" });
  });

  it("resolves /signup and /password-reset — no guard, no search params", async () => {
    const signup = routerAt("/signup");
    await signup.load();
    expect(signup.state.matches.find((m) => m.routeId === "/signup")).toBeDefined();

    const passwordReset = routerAt("/password-reset");
    await passwordReset.load();
    expect(passwordReset.state.matches.find((m) => m.routeId === "/password-reset")).toBeDefined();
  });

  it.each([
    ["/password-reset/confirm", "/password-reset/confirm"],
    ["/verify-email", "/verify-email"],
    ["/verify-email-change", "/verify-email-change"],
  ])("resolves %s with token undefined when the query string is missing it", async (path, routeId) => {
    const router = routerAt(path);
    await router.load();
    const match = router.state.matches.find((m) => m.routeId === routeId);
    expect(match?.search).toEqual({ token: undefined });
  });

  it.each([
    ["/password-reset/confirm", "/password-reset/confirm"],
    ["/verify-email", "/verify-email"],
    ["/verify-email-change", "/verify-email-change"],
  ])("resolves %s?token=abc123 with the token preserved exactly", async (path, routeId) => {
    const router = routerAt(`${path}?token=abc123`);
    await router.load();
    const match = router.state.matches.find((m) => m.routeId === routeId);
    expect(match?.search).toEqual({ token: "abc123" });
  });
});

describe("route-tree — slateIndexRoute resolves 'today' via the server, not a client-side guess", () => {
  beforeEach(() => {
    loginAsTestUser();
  });

  it("redirects /leagues/:leagueId/slate to the server-resolved dated URL", async () => {
    vi.spyOn(endpoints, "getSlate").mockResolvedValue({
      date: "2026-08-13",
      games: [],
      pickedCount: 0,
      totalCount: 0,
    });

    const router = routerAt("/leagues/league-1/slate");
    await router.load();

    expect(router.state.location.pathname).toBe("/leagues/league-1/slate/2026-08-13");
    expect(endpoints.getSlate).toHaveBeenCalledWith("league-1");
  });

  it("caches the resolved date so a second visit skips the network call entirely", async () => {
    vi.spyOn(endpoints, "getSlate").mockResolvedValue({
      date: "2026-08-13",
      games: [],
      pickedCount: 0,
      totalCount: 0,
    });

    await routerAt("/leagues/league-1/slate").load();
    expect(endpoints.getSlate).toHaveBeenCalledTimes(1);
    expect(getCachedSlateDate("league-1")).toBe("2026-08-13");

    const router = routerAt("/leagues/league-1/slate");
    await router.load();

    expect(router.state.location.pathname).toBe("/leagues/league-1/slate/2026-08-13");
    expect(endpoints.getSlate).toHaveBeenCalledTimes(1); // still 1 — the second visit used the cache
  });
});
