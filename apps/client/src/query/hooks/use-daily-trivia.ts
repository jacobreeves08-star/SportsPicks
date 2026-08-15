import { useQuery } from "@tanstack/react-query";
import { getDailyTrivia, getTriviaStats } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/**
 * Today's college quiz. Works logged-out — the endpoint is optionally
 * authenticated, and `apiFetch` attaches a token only when one exists.
 *
 * `staleTime: Infinity` because the underlying puzzle genuinely cannot
 * change within a day: it's built once and frozen (see the API's
 * lib/trivia-puzzle.ts). The one thing that DOES change is the
 * caller's own attempt, and that arrives on the answer mutation's
 * response rather than by refetching, so there's nothing to poll for.
 * A background refetch here would only cost a request and risk
 * flickering a half-finished round.
 */
export function useDailyTrivia() {
  return useQuery({
    queryKey: queryKeys.dailyTrivia(),
    queryFn: getDailyTrivia,
    staleTime: Infinity,
    // A 503 here is "the player pool hasn't been ingested yet", which
    // retrying cannot fix — the screen shows a "check back soon"
    // message instead of hammering the endpoint.
    retry: false,
  });
}

/** The caller's own quiz metrics — authenticated only, so callers must
 * gate this on being logged in (`enabled`) rather than letting it 401. */
export function useTriviaStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.triviaStats(),
    queryFn: getTriviaStats,
    enabled,
  });
}
