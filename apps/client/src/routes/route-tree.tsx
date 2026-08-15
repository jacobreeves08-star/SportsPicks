import { Outlet, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router";
import { AppShell } from "../app-shell/AppShell.js";
import { getAuthState } from "../api/auth-store.js";
import { getSlate } from "../api/endpoints.js";
import type { StandingsTimeframe } from "../api/types.js";
import { getCachedSlateDate, setCachedSlateDate } from "../leagues/current-league-store.js";
import { LoginScreen } from "../screens/auth/LoginScreen.js";
import { PasswordResetConfirmScreen } from "../screens/auth/PasswordResetConfirmScreen.js";
import { PasswordResetRequestScreen } from "../screens/auth/PasswordResetRequestScreen.js";
import { SignupScreen } from "../screens/auth/SignupScreen.js";
import { VerifyEmailChangeScreen } from "../screens/auth/VerifyEmailChangeScreen.js";
import { VerifyEmailScreen } from "../screens/auth/VerifyEmailScreen.js";
import { GolfScreen } from "../screens/GolfScreen.js";
import { HeadToHeadScreen } from "../screens/HeadToHeadScreen.js";
import { IndexScreen } from "../screens/IndexScreen.js";
import { CreateLeagueScreen } from "../screens/leagues/CreateLeagueScreen.js";
import { InvitePreviewScreen } from "../screens/leagues/InvitePreviewScreen.js";
import { JoinCodeEntryScreen } from "../screens/leagues/JoinCodeEntryScreen.js";
import { LeagueSettingsScreen } from "../screens/leagues/LeagueSettingsScreen.js";
import { ProfileScreen } from "../screens/ProfileScreen.js";
import { SlateScreen } from "../screens/SlateScreen.js";
import { StandingsScreen } from "../screens/StandingsScreen.js";
import { CollegeQuizPage } from "../screens/trivia/CollegeQuizScreen.js";
import { safeReturnTo } from "./post-login-redirect.js";

/**
 * The route tree (Epic 8 brief: "design before any screen exists" —
 * retrofitting deep links onto a client that holds league/date in
 * component state is a rewrite). Every route registered here is
 * deliberately typed end to end (path params via `$name` segments,
 * search params via `validateSearch`) so a future screen gets full
 * param typing for free, and so this file itself is the single
 * source of truth a screen can't quietly drift from by hand-
 * constructing a URL string.
 *
 * Epic 10 adds the persistent shell around whatever a route renders —
 * `authenticatedLayoutRoute`'s `component` (wired in app-shell/) is
 * the ONE place nav chrome + banners mount, not per-screen.
 */

const rootRoute = createRootRoute({
  // Deliberately minimal — Epic 10's ErrorBoundary wraps this from
  // main.tsx, not from here, so it also covers a crash on /login
  // itself. Real chrome (nav, banners) lives one level down, on
  // `authenticatedLayoutRoute`, since a logged-out user on /login or
  // /join shouldn't see a bottom nav.
  component: () => <Outlet />,
});

/**
 * `?returnTo=<path>` is the client half of the session-expiry contract
 * documented in docs/api-conventions.md and implemented in
 * api/client.ts / api/auth-store.ts: on an unrecoverable 401, the app
 * redirects here carrying the path the user was on, and navigates
 * back to it after a successful login — see routes/session-redirect.ts
 * for the piece that triggers the redirect TO here, and
 * routes/post-login-redirect.ts for navigating back FROM here once a
 * login screen (Epic 11) exists to call it.
 */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: LoginScreen,
});

/**
 * `?returnTo=<path>` here mirrors `loginRoute`'s exactly, and exists
 * for the same reason plus one more: the join deep-link flow (below,
 * `joinRoute`) needs "preview -> signup -> auto-join, without losing
 * the code" (Epic 11 brief) to actually work. Signup itself never logs
 * a user in (it only sends a verification email), so the code can't be
 * carried by staying authenticated through signup — instead,
 * `SignupScreen` threads this same `returnTo` into its own post-success
 * "log in" link, which chains into `loginRoute`'s already-built
 * `returnTo` -> `navigateAfterLogin` flow. The invite code itself never
 * moves: it's the URL the user lands back on, not client state.
 */
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: SignupScreen,
});

/** A single, reusable shape for the four `?token=` query-param routes
 * below (`validateSearch` is otherwise identical across all of them). */
function tokenSearchSchema(search: Record<string, unknown>): { token?: string } {
  return { token: typeof search.token === "string" ? search.token : undefined };
}

const passwordResetRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/password-reset",
  component: PasswordResetRequestScreen,
});

/** A flat sibling of `passwordResetRequestRoute`, not a child of it —
 * `"/password-reset"` and `"/password-reset/confirm"` are distinct
 * literal path strings, so both can hang directly off `rootRoute`
 * without a parent/child relationship, the same way `joinRoute` and
 * `legacyJoinRoute` already coexist below. */
const passwordResetConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/password-reset/confirm",
  validateSearch: tokenSearchSchema,
  component: PasswordResetConfirmScreen,
});

/**
 * `/verify-email` and `/verify-email-change` — the client-hosted
 * landing pages for the links `apps/api/src/routes/auth.routes.ts`'s
 * `verificationLink()` builds. Both routes were previously built
 * pointing at `PUBLIC_API_URL` (the API host itself), which returns
 * raw JSON with no client page at all — a real, now-fixed contract
 * gap (see that file's own updated comment and docs/app-shell.md-style
 * "found and fixed mid-epic" precedent from Epics 8/10). These two
 * client routes are the other half of that fix.
 */
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  validateSearch: tokenSearchSchema,
  component: VerifyEmailScreen,
});

const verifyEmailChangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email-change",
  validateSearch: tokenSearchSchema,
  component: VerifyEmailChangeScreen,
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
  component: InvitePreviewScreen,
});

/** Resolves the backend's actual `/join?code=XXXX` shape by redirecting
 * to the canonical `/join/$inviteCode` — so an invite link generated
 * by `GET /leagues/:leagueId/invite-code` today still lands correctly,
 * without the rest of the app ever needing to know two shapes exist.
 * With no `?code=` at all, this is the manual "enter a code" landing —
 * `JoinCodeEntryScreen` (Epic 11 Step 2's "code entry" step) instead
 * of a redirect. */
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
  component: JoinCodeEntryScreen,
});

/**
 * The single parent for every route that requires a logged-in user —
 * one `beforeLoad` guard here replaces what would otherwise be a
 * per-route repeated check. A pathless route (`id`, no `path`), so it
 * contributes nothing to the URL itself.
 *
 * Reads `api/auth-store.ts`'s `getAuthState()` directly — the same
 * synchronous, non-React module `session-redirect.ts` already reads
 * on the OTHER half of this contract (a session dying mid-use) — no
 * new auth-state source is introduced. `location.href` here is
 * TanStack Router's own resolved pathname+search (never an absolute
 * URL), but it's still routed through `safeReturnTo` for defense in
 * depth and to share exactly one validation rule with
 * `session-redirect.ts`.
 */
const authenticatedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  beforeLoad: ({ location }) => {
    const { accessToken } = getAuthState();
    if (!accessToken) {
      throw redirect({ to: "/login", search: { returnTo: safeReturnTo(location.href) } });
    }
  },
  component: AppShell,
});

/**
 * `/` — the one route in this app that is genuinely BOTH public and
 * authenticated, and therefore the one that can't hang off
 * `authenticatedLayoutRoute`.
 *
 * It used to: `/` was an auth-guarded route whose only behavior for a
 * stranger was to bounce to `/login`, so this app's front door WAS a
 * password field. The college-quiz feature requires a home page a
 * visitor can use with no account (its first trigger), and a shared
 * result link needs somewhere real to land, so `/` moved up to the
 * root and now decides what to render from auth state instead of
 * refusing to render at all.
 *
 * A COMPONENT-level branch, not a `beforeLoad` redirect to two
 * separate URLs: `/` has to keep working as one canonical address for
 * both audiences (`AppShell`'s brand link and `BottomNav`'s Home tab
 * both point here), and a logged-in user's home is still the leagues
 * screen with full shell chrome — which `MaybeShell` supplies.
 *
 * Every OTHER protected route is untouched and still guarded by
 * `authenticatedLayoutRoute` exactly as before.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexScreen,
});

/**
 * `/college-quiz` — public, for the same reason `/` is: the feature
 * brief's first trigger is "from the home page without needing to log
 * in", and this is also the URL a shared result points a friend at.
 * `CollegeQuizPage` wraps the screen in `MaybeShell`, so a logged-in
 * caller keeps their nav chrome and one URL serves both audiences.
 */
const collegeQuizRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/college-quiz",
  component: CollegeQuizPage,
});

const profileRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: "/profile",
  component: ProfileScreen,
});

/** Authenticated (creating a league requires an account) — a sibling
 * of `homeRoute`/`profileRoute`, not the public join flow above.
 * `/leagues/new` is a static segment, resolved ahead of
 * `leagueLayoutRoute`'s dynamic `/leagues/$leagueId` at the same
 * depth — standard TanStack Router precedence, confirmed by
 * route-tree.test.ts. */
const createLeagueRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: "/leagues/new",
  component: CreateLeagueScreen,
});

/** Shared layout for anything scoped to one league — a future screen
 * hangs league-wide chrome (name, nav between slate/standings) off
 * this, but it has no component of its own yet. */
const leagueLayoutRoute = createRoute({
  getParentRoute: () => authenticatedLayoutRoute,
  path: "/leagues/$leagueId",
});

/**
 * `/leagues/:leagueId/slate` — no date. The client has no reliable
 * way to guess "today" itself (a league's day boundary is in the
 * LEAGUE's timezone, docs/picks-and-locking.md, and `LeagueHomeEntry`
 * carries no timezone field to guess with) — so this resolves it the
 * honest way. `leagueId` comes from the parent route's own params.
 *
 * Checks `current-league-store.ts`'s per-league cached date FIRST —
 * paying a live `getSlate()` round trip on every nav tap to "my
 * league's slate" is a real, user-visible cost on bad wifi (this
 * app's own stated constraint). Only falls back to the network call
 * when nothing is cached yet for this league (first visit); either
 * way the resolved date is cached back for next time. A stale cached
 * date (pointing at yesterday) is harmless — the slate screen (Epic
 * 11) re-fetches for whatever date ends up in the URL regardless of
 * how it got there, so this is purely a "skip the redirect hop,"
 * never a correctness dependency.
 */
const slateIndexRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "slate",
  beforeLoad: async ({ params }) => {
    const cachedDate = getCachedSlateDate(params.leagueId);
    const date = cachedDate ?? (await getSlate(params.leagueId)).date;
    if (!cachedDate) setCachedSlateDate(params.leagueId, date);
    throw redirect({ to: "/leagues/$leagueId/slate/$date", params: { leagueId: params.leagueId, date }, replace: true });
  },
});

/** `/leagues/:leagueId/slate/:date` exactly as specified — `date` is a
 * required path segment (not a query param), matching how a pick-
 * reminder or results-summary notification link
 * (docs/notifications.md) needs to land on one exact day, not "today"
 * resolved client-side. */
const slateRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "slate/$date",
  component: SlateScreen,
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
  component: StandingsScreen,
});

/** `/leagues/:leagueId/head-to-head/:date` — a required path segment,
 * same shape as `slateRoute`, not a query param: "for any LOCKED
 * slate" (Epic 11 brief) means one exact day, and Standings links
 * here with the day it already has in hand (its own `date` field —
 * see `standings.routes.ts`, always today's date in the league's
 * timezone regardless of which timeframe is selected). */
const headToHeadRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "head-to-head/$date",
  component: HeadToHeadScreen,
});

/** `/leagues/:leagueId/settings` — commissioner-only, enforced by
 * `LeagueSettingsScreen` itself (not a `beforeLoad` guard here) since
 * the check needs both `useMe()` and `useLeague()`, which resolve
 * async after navigation, same posture as every other data-dependent
 * screen in this app (no route-level auth data prefetch exists yet). */
const leagueSettingsRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "settings",
  component: LeagueSettingsScreen,
});

/** `/leagues/:leagueId/golf` — no date segment, unlike `slateRoute`:
 * golf has at most one relevant tournament in flight at a time and the
 * server resolves which one, so there's nothing for a client to put in
 * the URL. See docs/sports-pipeline.md. */
const golfRoute = createRoute({
  getParentRoute: () => leagueLayoutRoute,
  path: "golf",
  component: GolfScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  collegeQuizRoute,
  loginRoute,
  signupRoute,
  passwordResetRequestRoute,
  passwordResetConfirmRoute,
  verifyEmailRoute,
  verifyEmailChangeRoute,
  joinRoute,
  legacyJoinRoute,
  authenticatedLayoutRoute.addChildren([
    profileRoute,
    createLeagueRoute,
    leagueLayoutRoute.addChildren([
      slateIndexRoute,
      slateRoute,
      standingsRoute,
      headToHeadRoute,
      leagueSettingsRoute,
      golfRoute,
    ]),
  ]),
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
