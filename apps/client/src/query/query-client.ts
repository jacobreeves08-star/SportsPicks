import { QueryClient } from "@tanstack/react-query";
import { ApiError, isNotReady } from "../api/errors.js";

/** How many times a transient failure is retried before the screen
 * gives up and shows its error state. TanStack Query's own backoff
 * formula (min(1000 * 2^attempt, 30000)) spaces them out. */
const MAX_RETRIES = 3;

/**
 * Whether a failed query is worth trying again — the one decision
 * behind every screen's "loading" vs. "couldn't load", so it lives in
 * a named, tested function rather than inline in the client config.
 *
 * Retrying a 4xx is pointless (PICK_LOCKED, VALIDATION_ERROR,
 * FORBIDDEN etc. will fail identically every time — the request
 * itself is wrong, not the network), so only network failures and 5xx
 * are retried.
 *
 * The exception is a `NOT_READY_CODES` 503, which is a 5xx that a
 * retry cannot fix: the server is fine, it just has no data yet. Those
 * are excluded HERE rather than by the screens that show them, because
 * a hook that opts out of retrying entirely to dodge them (which
 * `use-daily-trivia.ts` used to do) also loses the retry that every
 * other query gets for an offline blip, a dropped connection, or an
 * API instance that was still waking up — and the college quiz, the
 * one screen a visitor with no account lands on, is exactly where a
 * single unlucky request must not become a dead end.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isNotReady(error)) return false;
  if (error instanceof ApiError) {
    if (error.isNetworkFailure) return failureCount < MAX_RETRIES;
    return error.status >= 500 && failureCount < MAX_RETRIES;
  }
  return failureCount < MAX_RETRIES;
}

/**
 * The one QueryClient instance for this app. No `useEffect` + `fetch`
 * anywhere in this codebase (Epic 8 brief) — every read goes through a
 * query hook (query/hooks/) built on this client, which gets caching,
 * background refetch, request dedup, and retry-with-backoff for free
 * from TanStack Query itself rather than any of that being hand-rolled
 * per screen.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A beat above zero so a query that just resolved doesn't
        // instantly refetch on the next component mount/remount in
        // the same interaction — actual freshness for anything
        // lock-sensitive comes from query/polling.ts's explicit
        // refetchInterval, not from a short staleTime.
        staleTime: 10_000,
        // Retry with backoff — TanStack Query's own default backoff
        // formula is used as-is; the only thing customized here is
        // WHETHER to retry at all. See `shouldRetryQuery`.
        retry: shouldRetryQuery,
        // Explicit, not just relying on the (already-true) default —
        // this is HALF of "resync on tab focus": TanStack Query
        // refetches every currently-mounted query on window focus,
        // which naturally re-runs apiFetch and so resyncs the server
        // clock too (src/time/server-clock.ts). The OTHER half —
        // resyncing even when no query is mounted — is
        // src/time/focus-resync.ts's job, not this client's.
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Mutations (pick writes above all) must NEVER auto-retry
        // silently. An automatic background retry of a rejected or
        // timed-out write could resubmit stale data, or race a retry
        // against whatever the user does next — the opposite of the
        // "visible and explained" revert requirement (Step 6). Retry
        // semantics for a pick write are handled explicitly and
        // visibly by the offline queue (Step 7) instead, never by
        // this generic default.
        retry: false,
      },
    },
  });
}
