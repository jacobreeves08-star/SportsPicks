import { useEffect, useState } from "react";
import { getQueue, subscribeToQueue } from "./queue.js";

/**
 * The GLOBAL count of unsaved queued picks, across every league —
 * unlike `use-offline-queue.ts`'s `useOfflineQueue(leagueId, memberId)`,
 * which deliberately narrows to one league/member pair for a screen
 * showing that league's own slate. This hook reads `queue.ts`'s
 * cross-league array directly, for the shell's global "you have
 * unsaved picks somewhere" banner (app-shell/banners/), which has no
 * single league in scope.
 *
 * "failed" entries are excluded — same reasoning as
 * `useOfflineQueue.isQueued`: by the time an entry is failed, the
 * cache has already been reverted and the failure is a distinct,
 * already-surfaced-elsewhere signal (a screen's own rejection UI),
 * not "still pending, someone should know."
 */
export function useUnsavedPickCount(): number {
  const [queue, setQueue] = useState(getQueue);

  useEffect(() => subscribeToQueue(setQueue), []);

  return queue.filter((entry) => entry.status !== "failed").length;
}
