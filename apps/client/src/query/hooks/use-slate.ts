import { useQuery, type Query } from "@tanstack/react-query";
import { getSlate } from "../../api/endpoints.js";
import type { SlateResponse } from "../../api/types.js";
import { ApiError } from "../../api/errors.js";
import { deriveGameState } from "../../game-state/game-state.js";
import { correctedNow } from "../../time/server-clock.js";
import { queryKeys } from "../keys.js";
import { computeSlatePollingIntervalMs } from "../polling.js";

/** Derives this instant's polling context straight from the latest
 * slate response — recomputed on every tick TanStack Query considers
 * refetching, using the CORRECTED clock (never Date.now()), so a lock
 * that's about to happen speeds up polling automatically without
 * waiting for a server round trip to notice. */
export function pollingContextFromSlate(data: SlateResponse | undefined): { msUntilNearestLock: number | null; hasGamesInProgress: boolean } {
  if (!data) return { msUntilNearestLock: null, hasGamesInProgress: false };

  const now = correctedNow();
  let msUntilNearestLock: number | null = null;
  let hasGamesInProgress = false;

  for (const game of data.games) {
    const state = deriveGameState(game, now);
    if (state.kind === "SCHEDULED") {
      const remaining = state.startsAt.getTime() - now;
      if (msUntilNearestLock === null || remaining < msUntilNearestLock) {
        msUntilNearestLock = remaining;
      }
    } else if (state.kind === "LOCKED") {
      hasGamesInProgress = true;
    }
  }

  return { msUntilNearestLock, hasGamesInProgress };
}

/**
 * The one place the slate is fetched — see query/polling.ts for the
 * context-aware interval policy this feeds, and
 * docs/rate-limiting-and-caching.md for why it matters (this endpoint
 * is both rate-limited AND server-cached; polling faster than either
 * bound is pure waste).
 *
 * `refetchIntervalInBackground: false` is TanStack Query's default,
 * stated explicitly rather than silently relied on — this is what
 * makes "tab backgrounded -> pause entirely" true: a phone left open
 * on the slate overnight does not keep polling once its screen locks
 * or the tab is backgrounded, and resumes (via `refetchOnWindowFocus`,
 * query-client.ts) the moment it's foregrounded again.
 */
export function useSlate(leagueId: string, date?: string) {
  return useQuery({
    queryKey: queryKeys.slate(leagueId, date),
    queryFn: () => getSlate(leagueId, date),
    enabled: leagueId.length > 0,
    refetchIntervalInBackground: false,
    refetchInterval: (query: Query<SlateResponse, ApiError>) => {
      const context = pollingContextFromSlate(query.state.data);
      return computeSlatePollingIntervalMs(context);
    },
  });
}
