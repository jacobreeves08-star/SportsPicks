# App shell (Epic 10)

The persistent frame every screen renders inside: auth-gated routing with a seamless
return-to-where-you-were flow, mobile bottom-nav chrome, a fast league switcher, one
unified global-banner system, the notification permission/preferences flow, and an
app-level error boundary. **Screens themselves stay placeholders this epic** — `HomeScreen`,
`SlateScreen`, `StandingsScreen` are thin `EmptyState`s; `ProfileScreen` is the one
exception, since it mounts the real, backend-wired notification preferences UI (see
"Notifications" below). Epic 11 replaces the placeholders with real screens; nothing here
is rebuilt to do that — they mount inside the same shell.

Builds on `docs/client-architecture.md` (Epic 8 infrastructure) and `docs/design-system.md`
(Epic 9 components) without adding to either — every new component in this epic is a
*container* built from existing primitives and tokens, per Epic 9's own layering rule.

## Auth-gated routing

`apps/client/src/routes/route-tree.tsx` adds one pathless layout route,
`authenticatedLayoutRoute` (`id: "_authenticated"`, no `path`), as the single parent for
every protected route. Its `beforeLoad` reads `getAuthState()` (`api/auth-store.ts`)
directly — the same synchronous, non-React source `session-redirect.ts` already reads on
the other half of this contract (a session dying mid-use) — and redirects to
`/login?returnTo=<path>` when there's no access token. One guard, not one per route.

`returnTo` is the resolved pathname+search TanStack Router already computed
(`location.href`), carrying the full original path *and* query params, run through
`routes/post-login-redirect.ts`'s `safeReturnTo()` before being trusted anywhere:

```ts
export function safeReturnTo(returnTo: string | undefined): string {
  if (returnTo && /^\/(?!\/)/.test(returnTo)) return returnTo;
  return homePath();
}
```

Only a same-app relative path starting with exactly one `/` is accepted — a crafted
`?returnTo=https://evil.com` or the protocol-relative `?returnTo=//evil.com` (still an
open redirect) both fall through to `homePath()`. `session-redirect.ts` is routed through
the same function, so the two halves of the contract can't quietly diverge on what counts
as "safe." `navigateAfterLogin(router, returnTo)` is the other half — built and tested
this epic even though no login screen exists yet to call it (Epic 11), matching Epic 8's
"design before the screen exists" posture.

`rootRoute`'s `component` is now a bare `<Outlet/>` — real chrome (nav, banners) lives one
level down on `authenticatedLayoutRoute`, since `/login`/`/join` shouldn't show a bottom
nav. `authenticatedLayoutRoute.component` is `AppShell` (below).

### `slateIndexRoute` — resolving "today" without a guessed guess

`/leagues/:leagueId/slate` (no date) can't be resolved client-side by guessing "today" —
a league's day boundary is in the *league's* own timezone (`docs/picks-and-locking.md`),
and `LeagueHomeEntry` carries no timezone field to guess with. Rather than paying a live
`getSlate()` round trip on every nav tap (a real cost on bad wifi), it checks
`current-league-store.ts`'s per-league cached "last known slate date" first, only falling
back to the network on a league's first visit. The resolved date is cached back into the
store either way, so the next visit is instant. A stale cached date is harmless — the
slate screen (Epic 11) always re-fetches for whatever date lands in the URL, so this is
purely a "skip the redirect hop" optimization, never a correctness dependency.

## Current-league persistence

`leagues/current-league-store.ts` — localStorage-backed, mirroring `api/auth-store.ts`'s
shape (synchronous read, `subscribe`/`set`, defensive try/catch on every storage access):
`getCurrentLeagueId`/`setCurrentLeagueId`/`subscribeToCurrentLeague`, plus
`getCachedSlateDate(leagueId)`/`setCachedSlateDate(leagueId, date)` for the route
optimization above.

`leagues/use-current-league.ts`'s `useCurrentLeagueId()` combines the store with
`useMyLeagues()`, re-validating the stored id still appears in the caller's league list —
falls back to the first entry otherwise, handling having left or been removed from a
league since it was last selected.

### League switcher

`app-shell/LeagueSwitcher.tsx` — a native `<select>` (accessible for free, no custom
dropdown a11y work) that calls `setCurrentLeagueId()` then `router.navigate()`, no full
reload. Reads the current route match to decide what to preserve across the switch:

- On the slate route: carries the `$date` param straight across (Nov 12 in league A →
  Nov 12 in league B — the brief's exact example).
- On the standings route: carries the `range` search param across.
- Everywhere else (home, profile): navigates to the new league's `slateIndexRoute`, which
  resolves its own date.

## Navigation chrome

`app-shell/BottomNav.tsx` — fixed to the bottom, four destinations: home, the current
league's slate, its standings, profile. `position: fixed` here is the one deliberate
exception to "reserved layout space, not overlay" (see banners below) — a bottom nav is
expected to float over the very bottom of the screen. What it must never do is cover the
pick control or a countdown higher up the page; that's a screen-level responsibility
(Epic 11's slate screen reserves its own bottom padding to clear it, same as any fixed
bottom nav requires of its content). Slate/standings links need a current league — when
none is selected yet, those two render disabled rather than linking somewhere wrong.

`app-shell/AppShell.tsx` composes the whole frame as real document-flow rows:

```
[header (LeagueSwitcher)]
[BannerStack]
[Outlet]     ← routed screen content
[BottomNav]  ← fixed
```

`.main`'s own bottom padding (`AppShell.module.css`) is what keeps `BottomNav` from
covering routed content — the structural half of the same guarantee `BannerStack`
provides at the top of the screen.

## Global status banners

`app-shell/banners/` — **at most one banner at a time**, never a stack. On a phone, more
than one competing banner is itself a "can't reach the pick control" problem. Fixed
priority, most urgent first:

```
offline > degraded > reconnecting > unsaved-picks > stale
```

No connection or an unhealthy server dominate everything else. "Still flushing after
reconnecting" beats "some picks queued, idle" because it's actively in flight. Stale data
is informational — the lowest urgency of the five.

**Layout, not z-index, is what protects the pick control and a countdown.** `AppShell`
composes `[BannerStack][Outlet][BottomNav]` in real document flow — a banner occupies its
own reserved space and pushes content down; it never `position: fixed`-overlays anything.
This makes "banner covers content" structurally impossible rather than a convention a
later screen could violate.

### Data hooks (pure, tested independently)

- `network/use-online-status.ts` — wraps `navigator.onLine` plus `online`/`offline`
  listeners.
- `offline/use-unsaved-pick-count.ts` — reads `offline/queue.ts`'s global queue directly
  and counts entries with `status !== "failed"` across *every* league. Unlike
  `useOfflineQueue` (scoped to one league/member), this is the cross-league aggregation
  the banner needs.
- `observability/use-data-freshness.ts` — `useDataFreshness()` polls the existing
  `GET /health/data-freshness` (built in Epic 3 explicitly as "the hook a future
  stale-data banner would poll," `docs/observability.md` — no backend change needed this
  epic) and `useHealthPing()` polls `GET /health`, both on a 5-minute
  `refetchInterval` with `refetchIntervalInBackground: false` and `retry: false` — a
  failed freshness poll *is* the degraded signal; retrying would only delay surfacing it.

### Pure derivation

`derive-global-banner.ts`'s `deriveGlobalBanner()` mirrors `query/polling.ts`'s
pure-function-fed-by-a-hook split, tested standalone (full priority table) before
`use-global-banners.ts` wires it to the hooks above:

- `degraded` = the health ping failing **or** any tracked job in the freshness response
  has `lastRunSucceeded: false`.
- `stale` = `staleGameCount > 0`, banner's `asOf` = the response's `generatedAt`.
- `reconnecting` holds for a 5-second window (`RECONNECTING_WINDOW_MS`) right after
  `online` flips from false to true — long enough for the offline queue's own flush to
  realistically finish a small queue, short enough not to linger.

### Rendering

`stale` renders the existing design-system `StaleBanner` directly (already generic and
backend-agnostic for exactly this). The other four render the new
`app-shell/banners/StatusBanner.tsx` — `icon`/`message`/`tone` props, built entirely from
existing primitives and tokens: `tone="warning"` reuses `--color-error` (offline/degraded
are error-adjacent conditions), `tone="info"` reuses `--color-text-dim`. No new
design-system components or tokens were added.

## Notifications

The client half of the notification backend built in Epic 7 (`docs/notifications.md`).
Two real backend gaps were found and fixed this epic (confirmed with the user before
building):

- `GET /users/me` never exposed `notificationsEnabled` — added to `PUBLIC_PROFILE_COLUMNS`
  in `apps/api/src/routes/users.routes.ts`, since it's the caller's own resource, no
  privacy concern.
- `GET /leagues` (my-leagues list) computed `leagueMemberId` for its own SQL joins but
  never returned it — added to the response, since the client needs it to address any
  `/:leagueId/members/:memberId/...` route at all.

### Permission prompt — after the first slate, never cold

Asking for browser notification permission on first load gets denied, and a denied
permission is very hard to recover — this app has a hard daily deadline and the reminder
is the retention mechanism. So the ask fires exactly once, on the first render where a
slate transitions to fully picked:

- `notifications/first-completion-tracker.ts` — localStorage-backed
  `hasEverCompletedASlate()`/`markSlateCompleted()`, so the prompt fires exactly once ever,
  even across a reload mid-prompt.
- `notifications/notification-prompt-bus.ts` — a tiny pub/sub (`notifyPossibleSlateCompletion`/
  `onPossibleSlateCompletion`), same shape as `auth-store.ts`'s `emitSessionExpired`/
  `onSessionExpired`. Decouples the future Epic 11 slate screen (which calls
  `notifyPossibleSlateCompletion(slate)` once a pick lands) from this epic's shell React
  tree with zero import coupling.
- `notifications/use-first-completion-prompt.ts` — consumes the bus, returns `true`
  exactly on the render where `pickedCount === totalCount > 0` transitions true for the
  first time ever.
- `notifications/use-notification-permission.ts` — thin wrapper over
  `Notification.permission`/`Notification.requestPermission()`
  (`"unsupported" | "default" | "granted" | "denied"`).
- `notifications/PermissionPrompt.tsx` — the actual prompt, mounted from `ProfileScreen`.
  **Deliberately labeled as a separate "also get a browser notification" opt-in, never a
  rewording of the real email toggle** — this repo has no push delivery mechanism at all
  (`docs/notifications.md`: email only), so requesting browser permission today captures
  consent for a channel nothing sends to yet. The copy says so directly ("You'll still get
  email reminders either way").

### Preferences form

`notifications/use-notification-preferences.ts` wraps the two new PATCH endpoints:

- `useUpdateGlobalNotifications()` — optimistic against `queryKeys.me()` (the same cache
  `useMe()` reads), following `mutations/use-pick-mutation.ts`'s revert-on-rejection
  convention at a smaller scale: flip the cached value immediately, roll back to the exact
  prior snapshot on rejection.
- `useUpdateLeagueNotifications()` — **not** optimistic against a query cache, because
  there's no read endpoint for this value to cache (see the flagged gap below).
  `notifications/PreferencesForm.tsx` owns its own local per-league toggle state and
  reverts it directly on rejection via this mutation's per-call `onError`.

`PreferencesForm.tsx` is mounted from `ProfileScreen` — global toggle plus a per-league
toggle list, built from `Stack`/`Text` and a plain `<input type="checkbox">`, no new
design-system components.

**Flagged, accepted gap: no read endpoint for the per-league preference.** The obvious
place to add one — `GET /leagues/:leagueId/members` (the paginated member list) — was
rejected because it would leak one member's private notification setting to every other
member of the league, a real privacy regression, not a minor omission. A correctly-scoped
"my own membership" read route doesn't exist yet and wasn't built under this epic's time
pressure. Until it exists, `PreferencesForm`'s per-league toggles default to the schema
default (`true`) via local-only React state rather than a live read — writes are still
real; only the initial displayed state can be wrong if a preference was set on a previous
visit or by another client. See `apps/api/src/routes/leagues.routes.ts`'s own doc comment
on the PATCH route for the same flag from the backend side.

## Error boundary + client error tracking

`app-shell/ErrorBoundary.tsx` — a class component (still required under React 18.3.1; no
hook equivalent for `componentDidCatch`/`getDerivedStateFromError` exists at this
version). Mounted in `main.tsx` wrapping the *entire* `RouterProvider`, not just the
authenticated shell — a crash on `/login` must not white-screen either. On catch: reports
via `captureException`, renders the existing design-system `ErrorState` with a retry
action that does a full `window.location.reload()` — deliberately not just clearing local
state, since a caught render-tree error is definitionally unknown state and this app's
offline-queue write path shouldn't risk running against whatever's left of it.

`observability/error-tracking.ts` mirrors `apps/api/src/lib/error-tracking.ts`
function-for-function — `initErrorTracking()`, `captureException(err)`,
`captureMessage(message, extra?)`, every export a no-op unless `VITE_SENTRY_DSN` is set,
same convention as the server's `SENTRY_DSN`. Uses `@sentry/browser`, not `@sentry/react`
— this epic hand-builds its own `ErrorBoundary`, so React-specific Sentry bindings aren't
needed, and the base SDK is lighter, matching this app's repeated bad-wifi bundle-size
constraint (`docs/design-system.md`). `initErrorTracking()` runs first in `main.tsx`,
before the router or query client are constructed — same "as early as possible" placement
as the server's own `initErrorTracking()` at the top of `server.ts`.

## What Epic 11 inherits

Everything above is ready to build real screens on top of:
- `HomeScreen`/`SlateScreen`/`StandingsScreen` are placeholders wired as route
  `component`s — swap the component, the route/shell/nav/banners around it don't change.
- A slate screen only needs to call `notifyPossibleSlateCompletion(slate)` once a pick
  completes the day — the permission prompt wiring is already listening.
- The per-league notification-preference read gap (above) is real follow-up work, not
  solved by anything in Epic 11's likely scope — worth a small dedicated backend route
  when it's prioritized.
