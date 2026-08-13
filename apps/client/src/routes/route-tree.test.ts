import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./route-tree.js";

function routerAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return router;
}

describe("route-tree — deep link resolution", () => {
  it("resolves /leagues/:leagueId/slate/:date with typed path params", async () => {
    const router = routerAt("/leagues/league-1/slate/2026-08-13");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/leagues/$leagueId/slate/$date");
    expect(match?.params).toEqual({ leagueId: "league-1", date: "2026-08-13" });
  });

  it("resolves /leagues/:leagueId/standings with the default range when no query string is present", async () => {
    const router = routerAt("/leagues/league-1/standings");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/leagues/$leagueId/standings");
    expect(match?.params).toEqual({ leagueId: "league-1" });
    expect(match?.search).toEqual({ range: "today" });
  });

  it("resolves an explicit ?range=week", async () => {
    const router = routerAt("/leagues/league-1/standings?range=week");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/leagues/$leagueId/standings");
    expect(match?.search).toEqual({ range: "week" });
  });

  it("falls back to the default range for an invalid value, rather than erroring", async () => {
    const router = routerAt("/leagues/league-1/standings?range=bogus");
    await router.load();

    const match = router.state.matches.find((m) => m.routeId === "/leagues/$leagueId/standings");
    expect(match?.search).toEqual({ range: "today" });
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
});
