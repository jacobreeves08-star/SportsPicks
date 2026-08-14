/**
 * Which league the shell (bottom nav, league switcher) currently
 * points at, plus a small per-league "last known resolved slate date"
 * cache. `localStorage`-backed, mirroring `api/auth-store.ts`'s exact
 * shape (a tiny standalone store, not React state, for the same
 * reason: `routes/route-tree.tsx`'s `slateIndexRoute` needs
 * synchronous read access to the cached date from inside a
 * `beforeLoad`, which runs outside any component tree).
 */

const CURRENT_LEAGUE_STORAGE_KEY = "sports-pickem:current-league-id";
const SLATE_DATE_CACHE_STORAGE_KEY = "sports-pickem:cached-slate-dates";

function readCurrentLeagueId(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(CURRENT_LEAGUE_STORAGE_KEY) : null;
  } catch {
    // Corrupt/unavailable storage — treat exactly like "nothing selected
    // yet," never throw out of a module load (same discipline as
    // api/auth-store.ts's readFromStorage).
    return null;
  }
}

function readSlateDateCache(): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(SLATE_DATE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, string> = {};
    for (const [leagueId, date] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof date === "string") result[leagueId] = date;
    }
    return result;
  } catch {
    return {};
  }
}

let currentLeagueId: string | null = readCurrentLeagueId();
let slateDateCache: Record<string, string> = readSlateDateCache();
const listeners = new Set<(leagueId: string | null) => void>();

export function getCurrentLeagueId(): string | null {
  return currentLeagueId;
}

export function setCurrentLeagueId(leagueId: string): void {
  currentLeagueId = leagueId;
  try {
    localStorage.setItem(CURRENT_LEAGUE_STORAGE_KEY, leagueId);
  } catch {
    /* storage unavailable/full — in-memory value still correct for the
     * rest of this session; just won't survive a reload. */
  }
  for (const listener of listeners) listener(currentLeagueId);
}

export function subscribeToCurrentLeague(listener: (leagueId: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last date `slateIndexRoute` resolved "today" to for this
 * league, if any — lets a subsequent nav tap skip the live
 * `getSlate()` round trip that route's `beforeLoad` would otherwise
 * always pay (a real, flagged UX cost on bad wifi). Deliberately NOT
 * treated as authoritative for longer than "avoid one redirect hop" —
 * a stale cached date pointing at yesterday still resolves correctly,
 * since the actual slate screen (Epic 11) re-fetches for whatever
 * date is in the URL regardless of how it got there. */
export function getCachedSlateDate(leagueId: string): string | undefined {
  return slateDateCache[leagueId];
}

export function setCachedSlateDate(leagueId: string, date: string): void {
  slateDateCache = { ...slateDateCache, [leagueId]: date };
  try {
    localStorage.setItem(SLATE_DATE_CACHE_STORAGE_KEY, JSON.stringify(slateDateCache));
  } catch {
    /* same tolerance as above */
  }
}

/** Test-only reset — never call from application code. */
export function resetCurrentLeagueForTests(): void {
  currentLeagueId = null;
  slateDateCache = {};
  listeners.clear();
}
