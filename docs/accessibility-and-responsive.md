# Accessibility and responsive design (JAC-46)

**This is a spec, not an implementation.** There is no frontend anywhere in this repo — only `apps/api`. Every requirement below (keyboard nav, screen-reader labels, contrast, a phone screen) describes UI that doesn't exist yet, so nothing here is buildable in this epic. This document exists so that whoever builds the first frontend has the accessibility contract already worked out, tied directly to the API fields that already exist to support it — the same "document what the API provides, don't write UI code" treatment already given to the CAPTCHA and native-push contracts in `docs/rate-limiting-and-caching.md` and `docs/notifications.md`.

## Keyboard navigation

The whole pick flow — browsing a day's slate, selecting a team on an open game, submitting — must be fully operable without a mouse:

- Every game in the slate is a stop in tab order; the two (or three, for a game where `allowsDraw` is true — see `docs/picks-and-locking.md`) selectable sides are themselves individually focusable and activatable with Enter/Space, not just clickable.
- A **visible** focus indicator at every stop — not just the browser default outline suppressed by a CSS reset, which is a common accidental accessibility regression. Focus must be visible against both the unselected and selected states of a pick control.
- Locked games (`pickState` is `locked`, `final_hit`, or `final_miss` — see `docs/picks-and-locking.md`) are still focusable and readable (a screen-reader user needs to know a game locked and what happened), but their selection controls are not interactive — `disabled`/`aria-disabled`, not simply styled to look inert while still receiving a click.
- Submitting a pick (single or via whatever batch UI groups a day's slate) must be reachable and triggerable from the keyboard alone, with a clear success/failure signal — see "Live regions" below.

## Screen-reader labeling for the split pick control

The pick control is the one piece of UI this spec treats most carefully, since it's simultaneously a toggle, a status display, and (once locked) a read-only result — three different things depending on `pickState`. A label built from `pickState`/`locked`/`myPick` directly (never re-derived client-side — see `docs/picks-and-locking.md`'s "a client never re-derives the rule that makes a game interesting") should announce, per state:

| `pickState` | What the control announces |
|---|---|
| `unpicked` | "{Team A} vs {Team B}. No pick yet. Locks {relative/absolute time from `startsAt`}." |
| `picked_open` | "{Team A} vs {Team B}. You picked {myPick}. Still open — locks {time}." |
| `locked` | "{Team A} vs {Team B}. Locked. You picked {myPick}." or, if `myPick` is null, "Locked. You did not make a pick." — never silent about a missed pick. |
| `final_hit` | "{Team A} vs {Team B}. Final: {winningTeam} won. You picked {myPick} — correct." |
| `final_miss` | "{Team A} vs {Team B}. Final: {winningTeam} won. You picked {myPick} — incorrect." (or "You did not make a pick" if `myPick` is null) |

Each side of the control (the two team buttons, or three when a draw is allowed) needs its own accessible name identifying the team and its selection state (`aria-pressed` while open, not just a visual checkmark) — a screen-reader user tabbing through the control should be able to tell which side is currently selected without relying on the surrounding label alone.

## Live regions for state changes

A pick accepted or rejected (`PICK_LOCKED`, `GAME_CANCELED`, etc. — see `docs/picks-and-locking.md`'s rejection reasons) needs to be announced via an `aria-live` region, not conveyed by visual change alone (a color flash, a toast that only sighted users notice). Same for a slate poll that silently transitions a game to `locked` while the user is looking at it — the "still open" → "locked" transition is exactly the kind of live, unprompted change that needs an announcement, not just a visual re-render.

## WCAG AA contrast

Every text/background and meaningful-icon/background pairing meets WCAG AA (4.5:1 for normal text, 3:1 for large text and UI components) — explicitly including the win/loss states below, which are the easiest states to accidentally under-contrast (a pale green "win" tint is a common failure mode). `prefers-reduced-motion` (below) and contrast should both be checked against both a light and dark presentation if the eventual frontend supports theming — this doc doesn't assume one over the other, since neither exists yet.

## Win/loss must never be color-only

`hit` (from `GET /:leagueId/head-to-head` — `docs/scoring-and-standings.md`) and `pickState`'s `final_hit`/`final_miss` are the server-computed truth for whether a pick was correct. The UI must pair every win/loss indicator with an icon and/or text label, never color alone (green/red) — a colorblind user (the most common form, red-green colorblindness, affects roughly 1 in 12 men) must be able to tell a hit from a miss with color entirely removed. Concretely: a checkmark + "Correct" / an X + "Incorrect", not just a green or red background.

**Verification requirement for the eventual frontend**: render the pick results view in greyscale (a browser devtools color-vision simulation, or an actual greyscale filter) and confirm every win/loss state is still unambiguous. This is a testable acceptance criterion, not just a guideline — treat it the same as a WCAG contrast check, something to actually run before shipping the view, not just aspire to.

`split` (picks weren't unanimous) and `allWrong` (nobody picked the winner) from the head-to-head endpoint are supplementary framing, not replacements for the per-member `hit` indicator — they should get their own non-color-only treatment (e.g. a badge/icon on the game itself) but don't change the requirement above for each individual pick.

## `prefers-reduced-motion`

Any animation (a pick-selection transition, a live-score update pulse, a toast entrance) must have a reduced/instant variant behind `prefers-reduced-motion: reduce`. This app already has genuinely live-updating data (slate polling, in-progress scores) that's a natural place to over-animate — the reduced-motion variant should still convey the same state change, just without motion (an instant swap instead of a slide/fade).

## Responsive layout and real-device testing

A resized desktop browser window is not a substitute for a real phone — viewport quirks (safe-area insets, on-screen keyboard covering the pick control, actual touch-target sizing under a real thumb, not a mouse cursor) only show up on real hardware. **Testing on a real phone is a required step before shipping the first frontend**, not an optional nice-to-have — flagged explicitly here since it's the one item on this list that can't be verified by any tool or spec review, only by picking up a device.

Touch targets (the team-selection buttons in particular, given they're the single most-interacted-with control in the whole app) should meet the common ~44×44pt minimum target size guidance, with enough spacing between the two/three sides of one game's control that a mis-tap doesn't select the wrong team on a small screen — a real-money-adjacent mistake even without real money involved (see `docs/legal/terms-of-service.md`'s flagged gambling-regulation question), worth getting right regardless.

## What this document does not cover

This is a UI/interaction spec, not a testing plan or a component library. It doesn't prescribe a specific frontend framework, component library, or automated-testing tool (axe-core, Lighthouse CI, etc.) — those are implementation decisions for whoever builds the frontend, informed by this document's requirements rather than constrained by a choice made here with no frontend to validate it against.
