# Design system (Epic 9 — components, no screens)

`apps/client/src/design-system/` is the visual vocabulary Epics 10-11 build real screens on top of: semantic design tokens, typography/layout primitives, the split pick control (the signature, least-conventional piece of UI in the app), result/state indicators, first-class loading/empty/error/stale components, and a Storybook gallery — reviewable on a real phone, with an automated accessibility scan wired into CI. **Components only — zero screens, zero route wiring, zero real data fetching**, same "infrastructure before deadline" posture as Epic 8's client foundations (`docs/client-architecture.md`).

Design target for every decision here, stated by the user driving this epic: used one-handed, on a phone, in a bar, thirty seconds before kickoff, possibly on bad wifi.

## The one architectural rule everything else follows

`src/design-system/` has **zero imports** from `src/api/`, `src/query/`, `src/mutations/`, `src/offline/`, `src/game-state/`, or `src/time/`. Every component is pure and driven entirely by props — nothing in this directory calls `usePickMutation`, `useSlate`, `deriveGameState`, or touches `ApiError` directly. This is what makes "components only" literally true: every component is mockable in Storybook with plain data and testable without a `QueryClientProvider`. Epics 10-11 build *containers* on top of this directory that map real `pickState` / `GameState` / the mutation hook's `isPending`/`rejection` / the offline queue's `isQueued` onto these components' props — that mapping is deliberately out of scope here.

## Token layer (`src/design-system/tokens/`)

- **`tokens.css`** — the only place hex/px/shadow values live, as `:root` custom properties. Named by MEANING, never by hue: `--color-pick-mine`, `--color-result-hit`, `--color-result-miss`, `--color-state-locked`, `--color-state-open`, `--color-state-stale`, `--color-surface`, `--color-surface-raised`, `--color-border`, `--color-text`, `--color-text-dim`, plus `--color-focus-ring` and **`--color-error`** (added beyond the brief's named list — see "One addition beyond the brief" below). Spacing (`--space-1`..`--space-8`), radius (`--radius-sm/md/lg/full`), elevation (`--elevation-0/1/2`), and motion (`--motion-duration-fast/base`) tokens live here too.
- **`token-names.ts`** — typed `var(--x)` string constants for the rare case a component needs a token in an inline style. `token-names.test.ts` parses `tokens.css` directly and asserts every name referenced here actually exists there — one source of truth, drift is a test failure, not a silent divergence.
- **`contrast.ts`** — hand-rolled WCAG relative-luminance/contrast-ratio math (the standard W3C formula), not a package. `contrast.test.ts` parses `tokens.css` directly (again, no duplicated value table) and asserts every semantic foreground/background pairing this design system actually renders meets WCAG AA (4.5:1 normal text, 3:1 large text/UI components) — **including the hit/miss states explicitly**, per the brief. This is the reliable way to gate contrast in CI: jsdom's `getComputedStyle` doesn't do real layout/paint, so axe-core's own `color-contrast` rule can't be trusted there.

### One addition beyond the brief

`--color-error` was added for `ErrorState` (a failed request/fetch) — deliberately a **different token** from `--color-result-miss` (a correctly-graded losing pick), even though they start out the same hex value. "Named by meaning, never by hue" cuts both ways: these are different concepts that happen to share a color today, and keeping them as separate tokens means a future re-theme of "what red means for a network error" can diverge from "what red means for a wrong pick" without a collateral change.

## Primitives (`src/design-system/primitives/`)

`Text` (size/weight/color/tabular props, polymorphic `as`), `Stack` (flex layout, gap is always a spacing token), `Surface` (surface/raised container with radius + elevation), `NumericText` (a `Text` wrapper that always forces `font-variant-numeric: tabular-nums` — every record, score, rank, and countdown uses this, never plain `Text`, because proportional figures make a ticking countdown jitter and a standings column fail to align), and `Countdown`.

**`Countdown` is PURE** — it takes `remainingMs: number` as a prop and does **not** call `useCorrectedNow()` itself. A container (Epic 10/11) computes `remainingMs` from `correctedNow()` (`src/time/server-clock.ts`), never `Date.now()`, and re-renders on tick. Keeping the clock dependency out of the component is what makes it Storybook-mockable with a static value. It also renders a coarse, screen-reader-only equivalent ("Locks in about 5 minutes") separate from the visually-ticking, `aria-hidden` numeral — a countdown re-announcing itself every second would be unusable noise for assistive tech.

All primitives forward arbitrary HTML/ARIA attributes (`role`, `aria-*`, `id`, event handlers) via a `...rest` spread, so composing components can build proper semantics on top of them — `PickControl`'s `role="radiogroup"` row is a `Stack`-shaped `<div>` with ARIA attributes layered on, not a special case.

## Indicators (`src/design-system/indicators/`)

`ResultBadge` (hit/miss), `LockBadge`, `VoidBadge` (postponed/canceled, distinct text per reason). Every one pairs its color with an **independent** non-color signal — a distinct icon shape AND distinct text — so removing color entirely (a colorblind user, a greyscale render) still leaves the state unambiguous. Concretely: `ResultBadge` never renders only a colored icon or only a colored background; "Correct"/"Incorrect" is always visible text, and the check/x icon shapes are structurally different (verified in `ResultBadge.test.tsx` by comparing the two icons' actual SVG path data, not just their color).

**Verification note**: jsdom can't render pixels, so there's no automated literal-greyscale screenshot test. The automatable proxy used throughout this epic's tests is "every state differs on every signal OTHER than color" (text + icon shape). The a11y doc's own "render in greyscale and confirm unambiguous" check is still a real, required manual step before shipping the eventual results screen — flagged as unautomatable this session, same as the real-phone check below.

## Feedback (`src/design-system/feedback/`)

`Spinner`, `LoadingState` (skeleton slate-rows, not a spinner — reads as "already loading something row-shaped," which feels faster on bad wifi), `EmptyState`, `ErrorState` (message + `onRetry` callback — **no fetch/retry logic lives in this component**, a container decides what "retry" actually does), and `StaleBanner`.

**`StaleBanner` is deliberately distinct from `LoadingState`** — this is the brief's explicit requirement: "stale" means known-old data being shown, not "still fetching." Conflating the two would let a screen confidently display wrong information while visually claiming it's still loading. `StaleBanner` shows an **absolute** time ("Showing data as of 3:45 PM"), never a relative one ("5 minutes ago") — a relative label silently goes wrong the instant it stops re-rendering, which is exactly the failure mode this component exists to avoid.

**A real product-API gap found here, not silently worked around**: the brief says "when the sports data provider is degraded, the backend flags it." In the actual shipped API, `GET /health/data-freshness` exists but is explicitly ops-only — `docs/sports-pipeline.md` states plainly it is "not yet consumed by any frontend... the hook a future stale-data banner would poll." There is currently no per-slate "this data is degraded" signal on the product surface. Since this epic is components-only regardless, `StaleBanner` is built generic and backend-agnostic (`asOf` + optional `reason` strings) — whichever Epic 10/11 container wires it up may need a small product-API addition first (e.g., exposing staleness on the slate response itself). Flagged here so it isn't rediscovered as a surprise later.

### Reduced motion

`Spinner` and `LoadingState`'s skeleton pulse both use CSS keyframe animations neutralized under **two** triggers, converging on the same effect: the real `@media (prefers-reduced-motion: reduce)` query, and a manual `[data-motion="reduce"]` attribute Storybook's toolbar toggle sets on `<html>` (`.storybook/preview.ts`) — so a reviewer can preview the reduced-motion path without changing OS settings. `tokens.css`'s `--motion-duration-fast/base` tokens use the identical dual-trigger pattern for any one-shot transition. `src/design-system/utils/use-reduced-motion.ts` (a `matchMedia` hook, fully tested) exists for a future component that needs to branch actual render logic, not just suppress a CSS transition — nothing in this epic needed that, since CSS alone is more reliable (no flash-of-motion before a JS effect runs).

## The split pick control (`src/design-system/pick-control/`)

The signature component. One game row cut in two (or three, for a draw-eligible soccer game); tapping a side selects that team.

### It's a radio group, not two buttons

`role="radiogroup"` on the row (`aria-label` computed by `describePickControl`, below), each side `role="radio"` with `aria-checked` and a **roving `tabIndex`** (WAI-ARIA authoring practice: one side is `tabIndex={0}` at a time, the rest `-1`; Tab enters/exits the whole control in one stop). Arrow keys move focus **and** select — matching native `<input type="radio">` group behavior — while `Enter`/`Space` activate the focused side via the underlying `<button>`'s own native behavior (no custom key handling needed for that part).

**Disabled sides use `aria-disabled="true"`, never the native `disabled` attribute.** The a11y doc is explicit: a locked game's control must stay focusable and readable (a screen-reader user needs to know a game locked and what happened), and the native `disabled` attribute removes an element from tab order while `aria-disabled` does not. Arrow keys still move the roving focus among disabled sides — a screen reader user can read every side of a locked game's control without being able to change anything.

### `PickControlState` — the seven-variant contract

```ts
type PickControlState =
  | { status: "open"; selected: string | null }
  | { status: "locked"; selected: string | null }
  | { status: "final"; selected: string | null; winningTeam: string; outcome: "hit" | "miss" }
  | { status: "void"; reason: "postponed" | "canceled"; selected: string | null }
  | { status: "pending"; optimistic: string; previous: string | null }
  | { status: "rejected"; attempted: string; revertedTo: string | null; message: string }
  | { status: "queued"; queued: string; previous: string | null };
```

Covers the brief's six explicit states (`SCHEDULED`→`open`, `LOCKED`→`locked`, `FINAL`→`final`, `VOID`→`void`, from `src/game-state/game-state.ts`, plus `pending`/`rejected` from `usePickMutation`) **plus a seventh, `queued`**, for the offline write case `useOfflineQueue` already produces — an addition beyond the literal brief, justified by "bad wifi" being a stated design constraint and the fact that the offline queue hook already exists and produces exactly this state. Flagged as a default extension, not silently assumed.

Two real findings baked into this type, from reading the actual shipped contract rather than assuming:

1. **`final.outcome` is `"hit" | "miss"`, never a third value.** `selected: null` with `outcome: "miss"` is the correct encoding of "never picked, game's over" — this matches the real API's `pickState` field exactly: `final_miss` covers *both* "picked wrong" and "never picked." There is no separate "final and unpicked" value in the shipped contract, so the type doesn't invent one. `PickControl` never computes `outcome` itself by comparing `selected` to `winningTeam` — `docs/picks-and-locking.md` is explicit that a client never re-derives the rule that makes a game interesting; a container passes the server's own answer in.
2. **`'DRAW'` is a real, literal API value**, confirmed in `docs/data-model.md`/`docs/sports-pipeline.md`: `selected_team`/`winning_team` can literally be the string `'DRAW'` for the three soccer competitions (`teams.allowsDraw`). `PickControl` renders a third side whenever `allowsDraw` is true, using that exact literal as the side's `value` — `describeSide()` is the one place it becomes the human label "Draw."

`rejected.message` is a **plain string** the component just displays — the container is responsible for turning a real `ApiError.code` into that string, which is what keeps `ApiError` (and the rest of `api/`) entirely out of this directory's import graph. The revert is **always** what's rendered as the current selection (`revertedTo`, never `attempted`) — a screen must never look like a rejected write quietly succeeded, matching Epic 8's "visible, explained revert" requirement exactly.

### `describe-pick-control.ts` — one place the announcement text is written

`describePickControl(state, teams)` implements `docs/accessibility-and-responsive.md`'s screen-reader announcement table verbatim for the five real `pickState`-shaped cases, plus the same voice for `void`/`pending`/`rejected`/`queued`, which that table doesn't cover. Both the radiogroup's `aria-label` and `PickControl`'s internal live-region announcements read from this one function, so the two can never drift apart. `describe-pick-control.test.ts` covers the full table, including the draw-eligible case.

### Live announcements, entirely within a pure component

The a11y doc requires an `aria-live` announcement for two things: a pick accepted/rejected, and a **silent, poll-driven transition** (e.g. a game locking while the user is looking at the screen). `PickControl` satisfies both without any external data-fetching dependency: it diffs the previous render's fully-composed `describePickControl()` label against the current one via `useRef`+`useEffect`, and only pushes a new message into an internal visually-hidden `role="status" aria-live="polite"` region when the label's *meaning* actually changed — never on the initial mount, never on a re-render that doesn't change what a screen reader user would need to know.

## Accessibility in CI — two layers, no new browser-testing surface

1. **Static**: `eslint-plugin-jsx-a11y` (recommended ruleset) runs inside the *existing* `lint` CI job, which already covers `apps/client` — zero new CI job needed for this layer.
2. **Runtime**: `jest-axe`'s `toHaveNoViolations()` matcher, wired via `expect.extend` in `src/test-setup.ts`, asserted in every component's own test file. `PickControl.test.tsx` runs it **once per state variant** (all seven statuses, plus a draw-eligible case) — a disabled-but-focusable `locked` radio and an interactive `open` one are genuinely different failure modes, not one canonical render.
   - **`vitest-axe` was tried first and rejected**, not assumed to work: its matcher genuinely doesn't register against this workspace's Vitest 4 (`expect(...).toHaveNoViolations()` threw `"Invalid Chai property"`, confirmed with a throwaway smoke test before committing to a package). `jest-axe`'s matcher is a plain object handed to `expect.extend` with no runtime coupling to Jest itself, and it registers cleanly.
3. **The real CI gap this closes**: `apps/client`'s own Vitest suite never ran in CI at all before this epic — `.github/workflows/ci.yml`'s `test` job was (and remains) scoped to `apps/api` only, with a Postgres service container the client workspace doesn't need. A new `client` job was added, mirroring the existing jobs' exact style. Without it, every `jest-axe`/contrast assertion above would only ever run locally.
4. **`@storybook/addon-a11y`** is wired for **interactive, manual review only** — a live axe panel while browsing stories on a real phone — deliberately *not* gated in CI this epic, to avoid introducing a new Playwright-driven browser-testing surface. Confirmed working end-to-end during this epic's own verification pass: the "All States" `PickControl` story reports "No accessibility violations found" in the addon panel. The CI-gating obligation is met entirely by layers 1-2 above.

## Storybook

`apps/client/.storybook/main.ts` (`@storybook/react-vite`, reusing the workspace's existing Vite pipeline — zero extra bundler config) + `preview.ts` (imports `tokens.css` globally; a custom "Phone (375x812)" viewport listed first and set as the initial default, matching "used one-handed, on a phone"; the reduced-motion toolbar toggle described above; `@storybook/addon-a11y` registered).

```bash
npm run storybook --workspace apps/client        # dev server, localhost:6006
npm run storybook --workspace apps/client -- --host   # reachable from a real phone on the same LAN
npm run build-storybook --workspace apps/client  # static build, catches story-level errors headlessly
```

`@storybook/addon-essentials` is **not** installed — as of Storybook 9 its addons (controls, actions, viewport, backgrounds, docs) were folded into core, and the package itself stopped publishing past `9.0.0-alpha.12`. Installing it against this workspace's Storybook 10 fails dependency resolution outright (confirmed empirically during this epic, not assumed from stale advice).

## What Epics 10-11 inherit, and what they still need to decide

- **The `GameState`/`pickState`/mutation-hook/offline-queue → `PickControlState` mapping** is entirely unbuilt. This is real, non-trivial logic (deciding when to show `pending` vs `rejected` vs `queued`, correlating a per-hook `isPending` with a specific game since `usePickMutation` doesn't expose per-game scoping itself) that belongs in a container, not this directory.
- **The stale-data signal has no live product-API source yet** (see "Feedback" above) — `StaleBanner`'s props are ready; the data isn't.
- **Palette hex values** are a real implementation choice this epic had to make (components need real colors to render). The contrast tests verify whatever's chosen meets AA; the actual hues are best judged by eye in Storybook, and retuning them later only ever touches `tokens.css`.
- **Dark mode/theming stays explicitly out of scope**, carrying forward `docs/client-architecture.md`'s own prior deferral.
- **A real-device check is still required and unautomatable**: the a11y doc's own words — touch-target sizing, safe-area insets, and the greyscale-unambiguous check for `ResultBadge` are only truly verified by picking up a phone. This epic gets Storybook onto a phone (`--host`) but doesn't replace that step.
