import { ApiError } from "../../api/errors.js";
import type { SlateGame } from "../../api/types.js";
import type { GameState } from "../../game-state/game-state.js";
import type { PickControlState } from "../../design-system/index.js";
import type { PickRejection } from "../../mutations/use-pick-mutation.js";

/**
 * Turns a real rejection into the plain, pre-formatted string
 * `PickControlState`'s `rejected` variant expects — `PickControl`
 * itself never imports `ApiError` (docs/design-system.md), so this
 * mapping has to live in a container. `PICK_LOCKED` is "the one to
 * design UI around" (docs/client-api-contract.md) — a game locking
 * between the user's tap and the server's response is the single most
 * likely rejection on a real connection, so it gets the clearest,
 * calmest message.
 */
export function presentPickRejection(error: ApiError): string {
  switch (error.code) {
    case "PICK_LOCKED":
      return "This game locked before your pick saved.";
    case "GAME_CANCELED":
      return "This game was canceled.";
    case "GAME_POSTPONED":
      return "This game was postponed.";
    case "INVALID_TEAM_SELECTION":
      return "That's not a valid pick for this game.";
    default:
      return error.isNetworkFailure ? "Couldn't reach the server." : error.message;
  }
}

export interface DerivePickControlStateInput {
  game: SlateGame;
  gameState: GameState;
  isPending: boolean;
  isQueued: boolean;
  /** The raw, hook-level rejection — `usePickMutation` is scoped to
   * one hook instance, not one game, so this may belong to a
   * DIFFERENT game than the one being rendered; this function checks
   * `gameId` itself, so a caller never needs to pre-scope it. A
   * rejection whose `reason` is a network failure is deliberately
   * excluded here too — that failure surfaces through the offline
   * queue's own queued/failed lifecycle instead (a retry may still be
   * in flight), never as "rejected". */
  rejection: PickRejection | null;
  /** What `game.myPick` was immediately before the in-flight attempt
   * started — captured by the caller at the moment it called
   * `writePick`/`enqueue`, since by the time this function runs the
   * slate cache has already been optimistically overwritten. */
  pendingPrevious: string | null;
  /** The league's own `pickHorizonDays` (docs/leagues-and-membership.md)
   * — a game further out than this, while still `SCHEDULED`, derives
   * `not-yet-open` instead of `open`. */
  pickHorizonDays: number;
  /** Always `correctedNow()` (src/time/server-clock.ts), same
   * discipline as `deriveGameState`'s own `nowMs` — the horizon bound
   * is a ROLLING window from "now," so this function needs the current
   * instant, not just `gameState`'s already-fixed `startsAt`. */
  nowMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The mapping Epic 9's own docs flagged as deliberately unbuilt —
 * "real, non-trivial logic... belongs in a container, not this
 * directory." Real `pickState` (the caller's own outcome) + `GameState`
 * (the game itself, independent of viewer) + `usePickMutation`'s
 * per-call pending/rejection + `useOfflineQueue`'s `isQueued`, onto
 * `PickControlState`'s seven variants.
 */
export function derivePickControlState(input: DerivePickControlStateInput): PickControlState {
  const { game, gameState, isPending, isQueued, rejection, pendingPrevious, pickHorizonDays, nowMs } = input;

  // Highest precedence: an unacknowledged rejection is the most
  // specific, most important thing to show — a screen must never let
  // a later poll's "locked"/"final" quietly paper over a write the
  // user doesn't yet know failed. Scoped to this game, and a network
  // failure is excluded (see the field doc above) since that path
  // shows as "queued" instead while the offline queue retries it.
  const scopedRejection =
    rejection && rejection.gameId === game.gameId && !rejection.reason.isNetworkFailure ? rejection : null;

  if (scopedRejection) {
    return {
      status: "rejected",
      attempted: scopedRejection.attemptedSelectedTeam,
      revertedTo: scopedRejection.revertedTo,
      message: presentPickRejection(scopedRejection.reason),
    };
  }

  if (isPending) {
    return { status: "pending", optimistic: game.myPick ?? "", previous: pendingPrevious };
  }

  if (isQueued) {
    return { status: "queued", queued: game.myPick ?? "", previous: pendingPrevious };
  }

  switch (gameState.kind) {
    case "VOID":
      return { status: "void", reason: gameState.reason, selected: game.myPick };
    case "FINAL":
      // The server's own answer, never re-derived by comparing
      // `selected` to `winningTeam` (docs/picks-and-locking.md — a
      // client never re-derives the rule that makes a game
      // interesting). `final_hit`/`final_miss` are the only two
      // possible values once status is final; anything else would be
      // a contract violation, not a case to silently guess at.
      return {
        status: "final",
        selected: game.myPick,
        winningTeam: gameState.winningTeam,
        outcome: game.pickState === "final_hit" ? "hit" : "miss",
      };
    case "LOCKED":
      return { status: "locked", selected: game.myPick };
    case "SCHEDULED": {
      const horizonMs = nowMs + pickHorizonDays * MS_PER_DAY;
      if (gameState.startsAt.getTime() >= horizonMs) {
        const opensAt = new Date(gameState.startsAt.getTime() - pickHorizonDays * MS_PER_DAY);
        return { status: "not-yet-open", selected: game.myPick, opensAt: opensAt.toISOString() };
      }
      return { status: "open", selected: game.myPick };
    }
  }
}
