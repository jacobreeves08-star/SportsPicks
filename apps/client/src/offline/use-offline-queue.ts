import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { writePick } from "../api/endpoints.js";
import type { SlateResponse } from "../api/types.js";
import { queryKeys } from "../query/keys.js";
import {
  dismissFailedEntry,
  enqueuePickWrite,
  flushQueue,
  getQueue,
  subscribeToQueue,
  type QueuedPickWrite,
} from "./queue.js";

function setGamePick(
  queryClient: ReturnType<typeof useQueryClient>,
  leagueId: string,
  date: string | undefined,
  gameId: string,
  selectedTeam: string | null,
): void {
  const queryKey = queryKeys.slate(leagueId, date);
  queryClient.setQueryData<SlateResponse>(queryKey, (current) => {
    if (!current) return current;
    return {
      ...current,
      games: current.games.map((game) =>
        game.gameId === gameId
          ? { ...game, myPick: selectedTeam, pickState: selectedTeam !== null && game.pickState === "unpicked" ? "picked_open" : game.pickState }
          : game,
      ),
    };
  });
}

/**
 * React wiring for offline/queue.ts (Epic 8 brief — "this app gets
 * used on bar wifi"). The pure queue module has no query-client or
 * browser dependency; this hook is where those get attached:
 * - `write` is the real `writePick` endpoint call.
 * - a successful eventual send reconciles the slate cache with the
 *   server's confirmed value (same reconciliation
 *   mutations/use-pick-mutation.ts does for the online path).
 * - a CONFIRMED rejection (the queue learns, once actually sent, that
 *   the game had already locked, been canceled, etc.) reverts the
 *   optimistic "unsaved" fill back to the true prior value — the
 *   entry itself stays in the queue as `status: "failed"` until
 *   dismissed, which is what keeps the rejection reason visible
 *   rather than just quietly correcting the display.
 * - flushes are attempted on mount (in case entries survived a reload)
 *   and on the browser `online` event — NOT on a polling timer; the
 *   queue module's own backoff retry (queue.ts) covers "try again
 *   soon after a failure," and there's no reason to also poll
 *   unconditionally on top of that.
 */
export function useOfflineQueue(leagueId: string, memberId: string) {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<QueuedPickWrite[]>(() =>
    getQueue().filter((entry) => entry.leagueId === leagueId && entry.memberId === memberId),
  );

  useEffect(() => {
    return subscribeToQueue((full) => {
      setQueue(full.filter((entry) => entry.leagueId === leagueId && entry.memberId === memberId));
    });
  }, [leagueId, memberId]);

  const tryFlush = useCallback(() => {
    void flushQueue({
      write: (entry) => writePick(entry.leagueId, entry.memberId, entry.gameId, entry.selectedTeam),
      onEntrySucceeded: (entry, result) => {
        setGamePick(queryClient, entry.leagueId, entry.date, entry.gameId, result.selectedTeam);
      },
      onEntryFailed: (entry) => {
        // The write was actually sent and the server actually said no
        // — the "unsaved" optimistic fill must not keep implying it
        // might still land. Revert to the value from BEFORE this
        // entry was queued (captured at enqueue time — see
        // queue.ts's `previousSelectedTeam`), never a blind `null`.
        setGamePick(queryClient, entry.leagueId, entry.date, entry.gameId, entry.previousSelectedTeam);
      },
    });
  }, [queryClient]);

  useEffect(() => {
    tryFlush(); // survive a reload with entries already queued
    window.addEventListener("online", tryFlush);
    return () => window.removeEventListener("online", tryFlush);
  }, [tryFlush]);

  /**
   * Queues a write for later — the fallback path when a live attempt
   * (mutations/use-pick-mutation.ts) fails with a NETWORK error, or
   * when a caller already knows it's offline. Fills the slate cache
   * optimistically (so the pick control shows the attempted
   * selection immediately, same "instant" principle as the online
   * path) — `isQueued(gameId)` below is what a screen combines with
   * that fill to render it as visibly UNSAVED, never as confirmed.
   */
  const enqueue = useCallback(
    (input: { gameId: string; selectedTeam: string; date?: string; previousSelectedTeam: string | null }) => {
      const entry = enqueuePickWrite({ leagueId, memberId, ...input });
      setGamePick(queryClient, leagueId, input.date, input.gameId, input.selectedTeam);
      tryFlush(); // in case connectivity was actually fine and this was used defensively
      return entry;
    },
    [leagueId, memberId, queryClient, tryFlush],
  );

  /** True while a write for this game is queued and not yet confirmed
   * OR failed — a screen's one signal for "show this as unsaved, not
   * done." A `failed` entry is deliberately EXCLUDED: by that point
   * the cache has already been reverted (onEntryFailed above), and
   * the failure is surfaced instead via `queue` itself /
   * `dismissFailedEntry`, not as a lingering "unsaved" badge on a
   * selection that no longer reflects what's shown. */
  const isQueued = useCallback((gameId: string) => queue.some((entry) => entry.gameId === gameId && entry.status !== "failed"), [queue]);

  return {
    /** Every queued entry for this (league, member) — includes
     * `status: "failed"` entries until explicitly dismissed. */
    queue,
    enqueue,
    isQueued,
    dismissFailedEntry,
    retryNow: tryFlush,
  };
}
