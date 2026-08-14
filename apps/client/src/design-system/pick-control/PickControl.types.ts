/**
 * The visual-state contract for PickControl — deliberately NOT the
 * same shape as the API's `pickState` (unpicked/picked_open/locked/
 * final_hit/final_miss) or the client's `GameState`
 * (SCHEDULED/LOCKED/FINAL/VOID, src/game-state/game-state.ts). This
 * component has ZERO imports from api/, query/, mutations/, offline/,
 * game-state/, or time/ — it is pure and driven entirely by props, so
 * it can be rendered in Storybook with plain mock data and tested
 * without a QueryClientProvider. A future container (Epics 10-11) is
 * responsible for mapping real `pickState` + `GameState` + the
 * mutation hook's `isPending`/`rejection` + the offline queue's
 * `isQueued` onto this union — that mapping is deliberately out of
 * scope here.
 *
 * Covers the brief's six required states (SCHEDULED->`open`,
 * LOCKED->`locked`, FINAL->`final`, VOID->`void`, plus `pending` and
 * `rejected` from the mutation pattern) PLUS a 7th, `queued`, for the
 * offline write case `useOfflineQueue` already produces — the "bad
 * wifi" design target argues for building this now rather than
 * retrofitting it once real screens exist. See docs/design-system.md.
 */

export interface PickControlTeams {
  homeTeam: string;
  awayTeam: string;
  /** Team crest image URL, sourced from the provider (ESPN's
   * `team.logo`). Optional/nullable — Storybook mock data and any
   * manually-entered game may not have one, and the side simply
   * renders text-only when absent. */
  homeTeamLogoUrl?: string | null;
  awayTeamLogoUrl?: string | null;
  /** Team primary color, sourced from the provider (ESPN's
   * `team.color`) as a 6-digit hex string with NO leading '#' (e.g.
   * `"0e3386"`) — matches the wire format, converted to a real CSS
   * color only at the point of use (team-selection-style.ts).
   * Optional/nullable for the same reasons as the logo URLs; when
   * absent (or too close to the page background to read as a filled
   * selection) the selected side falls back to the plain accent
   * treatment instead of an invisible/broken fill. */
  homeTeamColor?: string | null;
  awayTeamColor?: string | null;
  /** Gates the literal `'DRAW'` third side (docs/data-model.md,
   * docs/sports-pipeline.md — the three soccer competitions only). */
  allowsDraw: boolean;
  /** ISO timestamp — used for the "locks at {time}" announcement
   * text, formatted as an absolute time (never relative, and never
   * computed from a live clock this component doesn't have access
   * to). */
  startsAt: string;
}

export type PickControlState =
  | { status: "open"; selected: string | null }
  /** Further out than the league's own `pickHorizonDays` — visible on
   * the slate (never hidden, per docs/leagues-and-membership.md's
   * confirmed UX) but not yet writable. `opensAt` is when picking
   * opens for THIS game (a container's `startsAt` minus the league's
   * horizon), not `teams.startsAt` itself. Always `selected: null` in
   * practice (a game beyond the horizon can never have an existing
   * pick — the horizon bound only ever loosens over time, never
   * tightens past an already-accepted write), but kept as `string |
   * null` for the same symmetry every other status here has. */
  | { status: "not-yet-open"; selected: string | null; opensAt: string }
  | { status: "locked"; selected: string | null }
  /**
   * `outcome` is `"hit" | "miss"`, never a third value —
   * `selected: null` with `outcome: "miss"` is the correct encoding
   * of "never picked, game's over": this matches the real API's
   * `pickState` semantics exactly (`final_miss` covers BOTH "picked
   * wrong" and "never picked"; there is no separate "final and
   * unpicked" value in the shipped contract). Never derive `outcome`
   * inside this component by comparing `selected` to `winningTeam` —
   * docs/picks-and-locking.md is explicit that a client never
   * re-derives the rule that makes a game interesting; a container
   * passes the server's own answer in.
   */
  | { status: "final"; selected: string | null; winningTeam: string; outcome: "hit" | "miss" }
  /** Matches `GameState`'s `VOID.reason` — postponed games can
   * recover to SCHEDULED later, canceled games are terminal. No
   * win/loss/penalty either way (docs/scoring-and-standings.md:
   * voided for everyone). */
  | { status: "void"; reason: "postponed" | "canceled"; selected: string | null }
  /** An optimistic write in flight (usePickMutation's `isPending`).
   * `previous` is kept for symmetry with `rejected`/`queued`, even
   * though the default rendering doesn't currently surface it. */
  | { status: "pending"; optimistic: string; previous: string | null }
  /** A rejected (or network-failed) write that hasn't been
   * acknowledged yet — usePickMutation's `PickRejection`, mapped by a
   * container. `message` is a plain, pre-formatted string (the
   * container turns a real `ApiError.code` into this) — PickControl
   * never imports `ApiError` itself. The revert is ALWAYS rendered:
   * `revertedTo` is what's shown as the current selection, never
   * `attempted` — a screen must never look like the rejected write
   * quietly succeeded. */
  | { status: "rejected"; attempted: string; revertedTo: string | null; message: string }
  /** Queued for offline retry (useOfflineQueue). Rendered with an
   * UNMISTAKABLE "not saved yet" marker — Epic 8's explicit
   * requirement: a queued write must never look optimistically done. */
  | { status: "queued"; queued: string; previous: string | null };

export type PickControlStatus = PickControlState["status"];
