/**
 * Context-aware slate-polling policy (Epic 8 brief) — this is what
 * protects the sports-feed rate limit. Per docs/client-api-contract.md's
 * current defaults: the slate endpoint allows 20 requests/min per
 * account (a ~3s floor) and is server-cached for 20s (SLATE_CACHE_TTL_SECONDS)
 * — polling faster than the cache TTL buys nothing but risk against
 * the rate limit; polling far slower than it misses a live lock
 * transition. Every interval below sits comfortably inside those two
 * bounds.
 *
 * Pure function, no TanStack Query import here on purpose — this is
 * the POLICY, independently testable from the query hook
 * (query/hooks/use-slate.ts) that feeds it live data and consumes its
 * answer as a `refetchInterval` callback.
 */

const NEAR_LOCK_WINDOW_MS = 15 * 60 * 1000; // "within ~15 min of any lock" per the brief
const NEAR_LOCK_POLL_MS = 10_000; // well under the 3s rate-limit floor; refreshes meaningfully inside the 20s server cache window when a lock is imminent
const IN_PROGRESS_POLL_MS = 25_000; // just past the 20s server cache TTL — faster would only re-serve the same cached response
/** No automatic polling at all — nothing on an idle slate is
 * time-sensitive enough to justify spending rate-limit budget. A
 * phone left open on the slate overnight, with nothing starting soon
 * and nothing in progress, must not keep polling — see the brief's
 * own framing. Manual pull-to-refresh and TanStack Query's own
 * refetch-on-focus still apply; this only turns off the INTERVAL. */
const IDLE_POLL_MS = false;

export interface PollingContext {
  /** Milliseconds from "now" (always the corrected clock —
   * src/time/server-clock.ts) until the soonest still-SCHEDULED game's
   * lock, or `null` if there's no upcoming lock to watch (nothing
   * scheduled today, or everything already locked/final/void). */
  msUntilNearestLock: number | null;
  /** True if any game on this slate is currently LOCKED without a
   * result yet — i.e. plausibly in progress, the case that wants
   * frequent-enough polling to catch a score update. */
  hasGamesInProgress: boolean;
}

export function computeSlatePollingIntervalMs(context: PollingContext): number | false {
  if (context.msUntilNearestLock !== null && context.msUntilNearestLock <= NEAR_LOCK_WINDOW_MS) {
    return NEAR_LOCK_POLL_MS;
  }
  if (context.hasGamesInProgress) {
    return IN_PROGRESS_POLL_MS;
  }
  return IDLE_POLL_MS;
}
