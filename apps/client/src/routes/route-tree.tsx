import { Outlet, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router";
import type { StandingsTimeframe } from "../api/types.js";

/**
 * The route tree (Epic 8 brief: "design before any screen exists" —
 * retrofitting deep links onto a client that holds league/date in
 * component state is a rewrite). No screens exist yet (Epics 9-11
 * build them), so no leaf route has a `component` — TanStack Router
 * is perfectly happy rendering an empty outlet for a matched route
 * with none; adding placeholder components here would be less honest
 * about "zero UI" than just not having them.
 *
 * Every route registered here is deliberately typed end to end (path
 * params via `$name` segments, search params via `validateSearch`) so
 * a future screen gets full param typing for free, and so this file
 * itself is the single source of truth a screen can't quietly drift
 * from by hand-constructing a URL string.
 */

const rootRoute = createRootRoute({
  // Not a screen — just enough that any matched route (all of which
  // are component-less right now) renders something legible during
  // dev/e2e verification instead of a blank page. Epics 9-11 replace
  // this with real layout chrome.
  component: () => (
    <>
      <p>Sports Pick&apos;em — client infrastructure only, no screens yet.</p>
      <Outlet />
    </>
  ),
});

/**
 * `?returnTo=<path>` is the client half of the session-expiry contract
 * documented in docs/api-conventions.md and implemented in
 * api/client.ts / api/auth-store.ts: on an unrecoverable 401, the app
 * redirects here carrying the path the user was on, and navigates
 * back to it after a successful login — see routes/session-redirect.ts
 * for the piece that actually triggers this navigation.
 */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
});

/**
 * The canonical, path-param join route the brief asks for. See the
 * `legacyJoinRoute` below for why a SECOND `/join` route also exists —
 * the backend's own generated invite deep link
 * (`GET /leagues/:leagueId/invite-code`'s `deepLink` field) is
 * `/join?code=XXXX`, not `/join/XXXX` — a real discrepancy between the
 * brief's requested shape and what's actually shipped, documented in
 * docs/client-api-contract.md's "Known contract gaps." Both are kept:
 * this one as the canonical shape new code should link to, the other
 * purely to correctly resolve a link someone actually clicks.
 */
const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join/$inviteCode",
});

/** Resolves the backend's actual `/join?code=XXXX` shape by redirecting
 * to the canonical `/join/$inviteCode` — so an invite link generated
 * by `GET /leagues/:leagueId/invite-code` today still lands correctly,
 * without the rest of the app ever needing to know two shapes exist. */
const legacyJoinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join",
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.code) {
      throw redirect({ to: "/join/$inviteCode", params: { inviteCode: search.code } });
    }
  },
});

/** Shared layout for anything scoped to one league — a future screen
 * hangs league-wide chrome (name, nav between slate/standings) off
 * this, but it has no component of its own yet. */
const leagueLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leagues/$leagueId",
});

/** `/leagues/:leagueId/slate/:date` exactly as specified — `date` is a
 * required path segment (not a query param), matching how a pick-
 * reminder or results-summary notification link
 * (docs/notifications.md) needs to land on one exact day, not "today"
 * resolved client-side. */
const slateRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "slate/$date",
});

const STANDINGS_TIMEFRAMES: readonly StandingsTimeframe[] = ["today", "week", "season"];

function isStandingsTimeframe(value: unknown): value is StandingsTimeframe {
  return typeof value === "string" && (STANDINGS_TIMEFRAMES as readonly string[]).includes(value);
}

/** `/leagues/:leagueId/standings?range=today|week|season` exactly as
 * specified — invalid or missing `range` defaults to `"today"` rather
 * than erroring, matching `GET /leagues/:leagueId/standings`'s own
 * server-side default (docs/client-api-contract.md) so a bare
 * `/standings` link (no query string at all) is still valid, not a
 * broken deep link. */
const standingsRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "standings",
  validateSearch: (search: Record<string, unknown>): { range: StandingsTimeframe } => ({
    range: isStandingsTimeframe(search.range) ? search.range : "today",
  }),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  joinRoute,
  legacyJoinRoute,
  leagueLayoutRoute.addChildren([slateRoute, standingsRoute]),
]);

/** `history` is only ever overridden by tests (a memory history, so
 * route resolution can be verified without a real browser location)
 * — application code always calls this with no argument, getting
 * TanStack Router's default browser history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
