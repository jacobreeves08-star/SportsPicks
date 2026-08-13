import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/errors.js";

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
        // formula (min(1000 * 2^attempt, 30000)) is used as-is; the
        // only thing customized here is WHETHER to retry at all.
        // Retrying a 4xx is pointless (PICK_LOCKED, VALIDATION_ERROR,
        // FORBIDDEN etc. will fail identically every time — the
        // request itself is wrong, not the network), so only network
        // failures and 5xx get the standard 3 attempts.
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            if (error.isNetworkFailure) return failureCount < 3;
            return error.status >= 500 && failureCount < 3;
          }
          return failureCount < 3;
        },
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
