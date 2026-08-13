/**
 * The one shared game-state module (Epic 8 brief): one enum, one
 * derive function, one transition-legality check. No screen (Epics
 * 9-11) may infer a game's state from a combination of raw booleans —
 * `isLocked && hasWinner && isVoid` gives eight combinations, half of
 * them impossible, and one impossible one WILL reach production. This
 * is the only sanctioned way to turn the API's raw fields into a
 * state a screen branches on.
 *
 * NOT the same enum as the slate endpoint's `pickState`
 * (`unpicked`/`picked_open`/`locked`/`final_hit`/`final_miss` — see
 * docs/client-api-contract.md and src/api/types.ts's `SlateGame`).
 * `pickState` bakes in the CALLER's own pick outcome; `GameState`
 * describes the game itself, independent of viewer. A screen showing
 * "did I get this one right" wants `pickState` straight from the API;
 * a screen deciding whether the pick control is interactive wants
 * `GameState`.
 */

export type GameStateKind = "SCHEDULED" | "LOCKED" | "FINAL" | "VOID";

export type GameState =
  | { kind: "SCHEDULED"; startsAt: Date }
  | { kind: "LOCKED"; startsAt: Date }
  | { kind: "FINAL"; startsAt: Date; winningTeam: string }
  /** `reason` distinguishes the one real asymmetry in this graph: a
   * `postponed` game can come back to `SCHEDULED` once schedule-ingest
   * finds a real new time (an unbounded recovery pass — see
   * docs/client-api-contract.md's "Known contract gaps"); a `canceled`
   * game is terminal and never recovers. Kept as ONE `VOID` kind (not
   * two separate top-level states) because every consumer of this
   * module treats them identically for display/interaction purposes
   * (docs/scoring-and-standings.md: "voided for everyone, never
   * counted as a loss") — `reason` exists only for the one place that
   * genuinely needs to distinguish them: `isLegalTransition` below. */
  | { kind: "VOID"; startsAt: Date; reason: "postponed" | "canceled" };

export interface GameStateInput {
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  startsAt: string | Date;
  winningTeam: string | null;
}

/**
 * The one place raw API fields (`status`, `startsAt`, `winningTeam` —
 * exactly the shape `SlateGame` already carries) become a `GameState`.
 * `nowMs` is the caller's responsibility to supply — always
 * `correctedNow()` (src/time/server-clock.ts) for anything actually
 * driving UI, NEVER `Date.now()` directly. Kept as an explicit
 * parameter (not read internally from the clock module) so this
 * function stays a pure, trivially-testable mapping with no import-
 * time coupling to the clock singleton — a test can hand it any
 * instant without faking global time.
 */
export function deriveGameState(input: GameStateInput, nowMs: number): GameState {
  const startsAt = typeof input.startsAt === "string" ? new Date(input.startsAt) : input.startsAt;

  if (input.status === "postponed" || input.status === "canceled") {
    return { kind: "VOID", startsAt, reason: input.status };
  }

  if (input.status === "final") {
    if (input.winningTeam !== null) {
      return { kind: "FINAL", startsAt, winningTeam: input.winningTeam };
    }
    // Contract violation from the API: score-poll writes `result` in
    // the SAME transaction as the status->'final' flip
    // (docs/scoring-and-standings.md), so "final with no winner" should
    // be unreachable. Never fabricate a winner if it somehow happens —
    // LOCKED (the start has definitely passed either way) is the
    // honest fallback, not a crash and not a guess.
    return { kind: "LOCKED", startsAt };
  }

  // status is 'scheduled' or 'in_progress'. `in_progress` only ever
  // happens after the start has passed, so it's LOCKED by construction
  // — but the *primary* signal for the scheduled/locked boundary is
  // time itself (nowMs >= startsAt), the exact boundary
  // `writePick`/the slate endpoint's own `locked` field both use
  // server-side (docs/client-api-contract.md) — this is what lets a
  // client recompute the transition LIVE, every tick of
  // useCorrectedNow, without waiting for the next poll to notice a
  // lock that just happened.
  if (input.status === "in_progress" || nowMs >= startsAt.getTime()) {
    return { kind: "LOCKED", startsAt };
  }
  return { kind: "SCHEDULED", startsAt };
}

/**
 * Whether `to` is a state this module's own transition graph allows
 * reaching from `from`. Deliberately PERMISSIVE for most pairs — this
 * is not a strict state machine the client walks step by step (the
 * client only ever samples a snapshot via polling; it can easily miss
 * an intermediate state entirely, e.g. SCHEDULED straight to FINAL
 * across two polls spanning an entire game while the tab was
 * backgrounded). Its real job is catching the genuinely IMPOSSIBLE
 * regressions — a docs/scoring-and-standings.md correction never
 * un-finalizes a game, and a canceled game never comes back — not
 * enforcing a lockstep sequence that doesn't reflect how this client
 * actually observes state.
 *
 * Transitions this module was built against, from the shipped code
 * (docs/client-api-contract.md's "Known contract gaps" has the full
 * reasoning for the VOID(postponed)->SCHEDULED edge, which the
 * original task brief's transition list didn't account for):
 *   SCHEDULED -> LOCKED (start passes)
 *   SCHEDULED -> SCHEDULED (reschedule, new start time, same status)
 *   SCHEDULED | LOCKED -> VOID(postponed | canceled)
 *   LOCKED -> FINAL (final detected)
 *   FINAL -> FINAL (result revision, regrade — winningTeam may change)
 *   VOID(postponed) -> SCHEDULED | LOCKED (schedule-ingest's unbounded
 *     postponed-game recovery pass finds a real new time)
 *   VOID(canceled) -> VOID(canceled) only (terminal)
 */
export function isLegalTransition(from: GameState, to: GameState): boolean {
  if (from.kind === "FINAL") {
    return to.kind === "FINAL";
  }
  if (from.kind === "VOID" && from.reason === "canceled") {
    return to.kind === "VOID" && to.reason === "canceled";
  }
  return true;
}

/** Only a SCHEDULED game has a live, interactive pick control — see
 * docs/picks-and-locking.md. LOCKED/FINAL/VOID are all read-only for
 * pick-writing purposes, for different reasons a screen may still
 * want to distinguish (LOCKED: too late; FINAL: already decided;
 * VOID: nothing to decide) — this helper only answers the yes/no
 * "can a pick be written right now" question. */
export function isPickable(state: GameState): boolean {
  return state.kind === "SCHEDULED";
}
