import { useCallback, useRef, useState } from "react";
import { ApiError } from "../../api/errors.js";
import type { SlateGame } from "../../api/types.js";
import type { GameState } from "../../game-state/game-state.js";
import type { PickControlState } from "../../design-system/index.js";
import { usePickMutation } from "../../mutations/use-pick-mutation.js";
import { useOnlineStatus } from "../../network/use-online-status.js";
import { useOfflineQueue } from "../../offline/use-offline-queue.js";
import { derivePickControlState, presentPickRejection } from "./derive-pick-control-state.js";

/**
 * The container-side mapping Epic 9's `PickControl.types.ts` flagged
 * as deliberately out of scope for the design system: composes
 * `usePickMutation` (online writes), `useOfflineQueue` (offline
 * writes + their own independent `status: "failed"` terminal state),
 * and `useOnlineStatus` (which path a new attempt takes) into one
 * `getState`/`selectPick` pair a slate screen can call per game.
 *
 * Three failure/in-flight surfaces exist and must never be conflated:
 * 1. `usePickMutation`'s `isPending` is scoped to its ONE hook
 *    instance, not per-game — tracked here as a local `Set` via the
 *    per-call `mutate(vars, { onSettled })` options.
 * 2. A network failure from the online path is redirected into the
 *    offline queue (`enqueue`) rather than left to render as
 *    `usePickMutation`'s own `rejection` — `derivePickControlState`
 *    already excludes network-flavored rejections for this reason.
 * 3. A `QueuedPickWrite` that the offline queue itself confirms was
 *    REJECTED by the server (`status: "failed"`, `flushQueue`'s own
 *    `onEntryFailed` path) never touches `usePickMutation` at all —
 *    it's checked here directly and takes precedence over anything
 *    else, same "most specific, most important" rule
 *    `derivePickControlState` already applies to its own rejection.
 */
export function useSlatePicks(
  leagueId: string,
  memberId: string,
  date: string | undefined,
  pickHorizonDays: number,
  nowMs: number,
) {
  const mutation = usePickMutation(leagueId, memberId);
  const offlineQueue = useOfflineQueue(leagueId, memberId);
  const isOnline = useOnlineStatus();

  const [pendingGameIds, setPendingGameIds] = useState<ReadonlySet<string>>(new Set());
  const previousPickRef = useRef<Record<string, string | null>>({});

  const selectPick = useCallback(
    (game: SlateGame, selectedTeam: string) => {
      const previousPick = game.myPick;
      previousPickRef.current[game.gameId] = previousPick;

      // A fresh attempt supersedes any stale, already-failed offline
      // entry for this same game — the user trying again IS the
      // acknowledgment, the same rule usePickMutation's own onMutate
      // already applies to a stale online rejection.
      const staleFailedEntry = offlineQueue.queue.find((entry) => entry.gameId === game.gameId && entry.status === "failed");
      if (staleFailedEntry) offlineQueue.dismissFailedEntry(staleFailedEntry.id);

      if (!isOnline) {
        offlineQueue.enqueue({ gameId: game.gameId, selectedTeam, date, previousSelectedTeam: previousPick });
        return;
      }

      setPendingGameIds((current) => new Set(current).add(game.gameId));
      mutation.writePick(
        { gameId: game.gameId, selectedTeam, date },
        {
          onSettled: () => {
            setPendingGameIds((current) => {
              if (!current.has(game.gameId)) return current;
              const next = new Set(current);
              next.delete(game.gameId);
              return next;
            });
          },
          onError: (error) => {
            if (error.isNetworkFailure) {
              offlineQueue.enqueue({ gameId: game.gameId, selectedTeam, date, previousSelectedTeam: previousPick });
            }
          },
        },
      );
    },
    [isOnline, mutation, offlineQueue, date],
  );

  const getState = useCallback(
    (game: SlateGame, gameState: GameState): PickControlState => {
      const failedEntry = offlineQueue.queue.find((entry) => entry.gameId === game.gameId && entry.status === "failed");
      if (failedEntry) {
        return {
          status: "rejected",
          attempted: failedEntry.selectedTeam,
          revertedTo: failedEntry.previousSelectedTeam,
          message: failedEntry.lastError
            ? presentPickRejection(new ApiError(failedEntry.lastError, 0))
            : "This pick didn't save.",
        };
      }

      return derivePickControlState({
        game,
        gameState,
        isPending: pendingGameIds.has(game.gameId),
        isQueued: offlineQueue.isQueued(game.gameId),
        rejection: mutation.rejection,
        pendingPrevious: previousPickRef.current[game.gameId] ?? null,
        pickHorizonDays,
        nowMs,
      });
    },
    [pendingGameIds, mutation.rejection, offlineQueue, pickHorizonDays, nowMs],
  );

  return { getState, selectPick };
}
