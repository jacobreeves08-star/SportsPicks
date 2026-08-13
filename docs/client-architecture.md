# Client architecture (Epic 8 — client infrastructure)

`apps/client` is a new npm workspace: React web (Vite + TypeScript), chosen over React Native — flagged during planning as a default, not a confirmed decision, since `docs/accessibility-and-responsive.md`'s own phrasing ("a resized browser window vs. a real phone") implies a responsive web app, and it's the more reversible choice of the two. Say the word to pivot; nothing built this epic is native-specific.

**This epic builds infrastructure only — zero screens.** Epic 9 built the design system on top of it (component library, still zero screens — see `docs/design-system.md`); Epics 10-11 build the actual pick-flow, standings, and league-management UI using both. Every module below exists so those epics can build screens without first solving clock correctness, cache/polling policy, optimistic-write safety, offline behavior, or deep-linking from scratch — the same "solve it once, correctly, before anyone needs it under deadline" posture this repo has taken with every prior epic.

`docs/client-api-contract.md` is the ground truth this whole workspace is built against — read it first; it documents the actual shipped API (not a guess) and two real discrepancies (plus a CORS gap, added mid-epic) found between the original task brief and what's actually shipped.

## Module map

| Path | What it is |
|---|---|
| `src/api/` | The typed API client — `client.ts` (the one `fetch()` call site, session-expiry contract, clock-sync recording), `endpoints.ts` (one typed function per documented route), `errors.ts` (`ApiError`), `auth-store.ts` (token storage + the session-expired event), `types.ts`, `config.ts`. |
| `src/time/` | Server-time sync — `server-clock.ts` (pure NTP-style offset), `use-clock.ts` (the React hook a countdown ticks from), `focus-resync.ts` (unconditional resync on tab visibility change). |
| `src/game-state/` | The one shared game-state module — `game-state.ts`: `GameState` (SCHEDULED/LOCKED/FINAL/VOID), `deriveGameState()`, `isLegalTransition()`, `isPickable()`. |
| `src/query/` | TanStack Query wiring — `query-client.ts`/`query-provider.tsx`, `keys.ts` (the query-key factory), `polling.ts` (the context-aware slate-polling policy), `hooks/` (`useSlate`, `useMe`, `useMyLeagues`, `useStandings`). |
| `src/mutations/` | `use-pick-mutation.ts` — the shared optimistic pick-write hook: instant fill, server confirm, a revert that can't be made silent by accident. |
| `src/offline/` | `queue.ts` (the persisted, coalescing write queue + retry-with-backoff) and `use-offline-queue.ts` (its React/query-cache wiring). |
| `src/routes/` | `route-tree.tsx` (the deep-link route tree, no leaf components yet), `paths.ts` (pure path builders), `session-redirect.ts` (wires `auth-store`'s session-expiry event to the router). |
| `src/design-system/` | **Epic 9** — the component library (tokens, primitives, indicators, feedback states, the split pick control). Zero imports from any module above — pure, prop-driven, Storybook-mockable. Full detail in `docs/design-system.md`. |
| `src/e2e-harness/`, `harness.html`, `src/harness.tsx` | **Test-only** — a minimal page that mounts the real hooks so `e2e/lock-transition.spec.ts` has something to assert against. Not a product screen; never referenced from `main.tsx` or the real route tree; excluded from `npm run build`'s output. |
| `e2e/` | Playwright, against the real API + real local Postgres. |

## How the pieces compose

```
correctedNow() (time/server-clock.ts)
        │  fed by X-Server-Time on every response (api/client.ts)
        ▼
deriveGameState() (game-state/game-state.ts)  ◄── raw SlateGame fields (api/types.ts)
        │
        ▼
query/hooks/use-slate.ts ──► query/polling.ts (how often to refetch, given the derived state)
        │
        ▼
mutations/use-pick-mutation.ts (online write path)  ──┐
offline/use-offline-queue.ts (offline write path)   ──┴──► same slate query cache, reconciled either way
```

- **Every countdown and lock check uses `correctedNow()`, never `Date.now()`.** The client-side lock (`deriveGameState`'s `LOCKED`) is a UI hint only — `writePick` always re-decides independently, server-side, every time (`docs/picks-and-locking.md`). This is proven, not just asserted: `e2e/lock-transition.spec.ts` watches a real game's client-derived state flip live and confirms a write attempted right after is genuinely rejected by the real server.
- **One state enum, derived, never inferred from booleans.** `pickState` (from the slate API) and `GameState` (derived client-side) are deliberately different things — see `game-state.ts`'s own doc comment for exactly why, and the one real discrepancy found between the task brief's transition list and what the shipped backend actually does (a postponed game recovering back to `SCHEDULED`).
- **Polling is context-aware and bounded by what the server actually supports** (`docs/rate-limiting-and-caching.md`'s 20/min slate rate limit, 20s server cache): fast near a lock, moderate with games in progress, off when idle, and paused entirely while the tab is backgrounded (TanStack Query's own `refetchIntervalInBackground: false`, stated explicitly).
- **A pick write is never silently lost.** Online: `usePickMutation` fills instantly, confirms with the server, and on rejection reverts to the exact prior value while leaving a `PickRejection` in place until a screen explicitly dismisses it — never a self-clearing toast. Offline: `useOfflineQueue` queues the write, fills the same way, and — critically — **never implies the write succeeded**; a queued write that turns out to be rejected once actually sent (the game locked while offline) reverts the same way, with the real reason.
- **Every deep link is typed end to end**, matching exactly the three required patterns plus the session-expiry redirect (`?returnTo=`) — see `route-tree.tsx`.

## Two real gaps found and fixed mid-epic (backend changes, not client workarounds)

Both were "check first, then add only what's missing" fixes to `apps/api`, not scope creep — a client that can't reach the API at all isn't infrastructure, it's nothing:

1. **`X-Server-Time` header** (`apps/api/src/app.ts`) — didn't exist before this epic. Node's implicit `Date` header is 1-second resolution and undocumented; this is explicit, millisecond-precision ISO-8601, matching this API's own timestamp convention.
2. **CORS** (`apps/api/src/app.ts`, `@fastify/cors`) — didn't exist AT ALL before this epic. Found only once the e2e harness drove a real browser for the first time (every manual `curl` check throughout the epic looked fine, since `curl` never performs a CORS preflight). Two layers: no CORS registration at all (fixed), then `@fastify/cors`'s own default `methods` list silently excluding `PUT`/`PATCH`/`DELETE` (fixed) — see `docs/client-api-contract.md` for the full story and `apps/api/src/app.test.ts` for the regression coverage.

## What Epics 9-11 inherit, and what they still need to decide

Everything above is ready to build screens on top of. Explicitly NOT decided by this epic, on purpose (screen-level, not infrastructure):
- What a `PickRejection`/queued-and-unsaved pick actually *looks like* on screen — this epic guarantees the DATA is there (`rejection`, `isQueued(gameId)`) and that it can't be silently dropped; the visual treatment is a design decision. **Update (Epic 9)**: the visual treatment now exists — `PickControl`'s `rejected`/`queued` states (`docs/design-system.md`) — but the MAPPING from this epic's `PickRejection`/`isQueued(gameId)` onto that component's props is still unbuilt; that's a container, which is Epic 10/11's job, not this one's.
- Any UI framework/component library, styling approach, or design system. **Update (Epic 9)**: decided and built — React + Vite + CSS Modules, `src/design-system/`, see `docs/design-system.md`.
- The home screen, league-management screens, standings views, etc. — none of `src/query/hooks/` beyond `useSlate` were built out further than what this epic's own modules needed to demonstrate/test. Still true after Epic 9 (components only, no screens).
- The push-notification registration flow (`docs/notifications.md`'s documented-not-built contract) and the CAPTCHA contract (`docs/rate-limiting-and-caching.md`) — both still apply once a real signup/settings screen exists.
