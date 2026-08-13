import { env } from "./env.js";

/**
 * Slate-read cache (JAC-43-48) — the underlying game/pick data only
 * changes when an ingest job runs (score-poll at its 5-minute fastest)
 * or when a member writes a pick, so a short TTL dramatically cuts DB
 * load from a client polling the slate endpoint for live lock
 * transitions. See docs/rate-limiting-and-caching.md for the full
 * design and its accepted tradeoffs; the short version:
 *
 * - Keyed by `(leagueId, date, viewerMemberId)` and caches the FULLY
 *   REDACTED response the route already builds, never raw joined data.
 *   The slate query is not viewer-independent — `myPick` and
 *   `otherPicks`'s self-exclusion/lock-gated `selectedTeam` differ per
 *   caller (docs/picks-and-locking.md's "enforced in the query, not
 *   after it"). Caching the query's OUTPUT keeps that guarantee exactly
 *   where it already lives (one SQL CASE expression, verified against
 *   real Postgres) rather than moving it into application code that has
 *   to correctly re-redact a cached row on every hit.
 * - A plain in-memory `Map`, not Redis — matches this repo's established
 *   no-Redis, low-ops pattern. Correct for the current single-instance
 *   web service; if it ever scales horizontally, cache entries diverge
 *   across instances and a write on one instance won't invalidate
 *   another's. Not fixed now — a known, accepted limitation.
 * - `invalidateLeague` (called from `writePick` on any accepted write)
 *   handles same-member-immediately-sees-their-own-write; the TTL alone
 *   handles job-driven staleness (deliberately not actively invalidated
 *   cross-job — a job doesn't cheaply know which leagues cover a
 *   changed game's sport). A slate response may lag up to
 *   `SLATE_CACHE_TTL_SECONDS` behind a job-driven change; a member's own
 *   pick write is always reflected immediately regardless of TTL.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheKey(leagueId: string, date: string, viewerMemberId: string): string {
  return `${leagueId}:${date}:${viewerMemberId}`;
}

export function getCachedSlate<T>(leagueId: string, date: string, viewerMemberId: string): T | undefined {
  const key = cacheKey(leagueId, date, viewerMemberId);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/**
 * `ttlSeconds` defaults to the configured `SLATE_CACHE_TTL_SECONDS` —
 * overridable so tests can exercise real expiry without waiting out the
 * production default.
 */
export function setCachedSlate<T>(
  leagueId: string,
  date: string,
  viewerMemberId: string,
  value: T,
  ttlSeconds: number = env.SLATE_CACHE_TTL_SECONDS,
): void {
  cache.set(cacheKey(leagueId, date, viewerMemberId), { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Called from `writePick` on any accepted write — coarse (evicts every
 * cached date/viewer for this league, not just the affected game's day)
 * but cheap at this scale, and simpler than computing which day bucket
 * a given game's `starts_at` falls into per league timezone just to
 * evict one entry.
 */
export function invalidateLeague(leagueId: string): void {
  const prefix = `${leagueId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Test-only: this cache is a module-level singleton, shared across every test in a process. */
export function clearSlateCacheForTests(): void {
  cache.clear();
}
