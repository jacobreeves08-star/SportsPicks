/**
 * Wires "resync on tab focus" (Epic 8 brief, explicit requirement) on
 * top of server-clock.ts's pure offset logic. A phone that's been
 * asleep or backgrounded for hours has a stale sync sample — and more
 * importantly, TanStack Query's own `refetchOnWindowFocus` only
 * refreshes QUERIES THAT ARE CURRENTLY MOUNTED; a screen with no
 * active queries (or one still loading) would otherwise get no resync
 * at all on focus. This module resyncs unconditionally, independent
 * of whatever queries happen to be active, via a caller-supplied
 * lightweight ping (the app wires this to the unauthenticated
 * `GET /health` endpoint — cheap, no auth, no rate limit concerns).
 *
 * `document`/`visibilitychange` (not `window`/`focus`) on purpose:
 * `visibilitychange` fires correctly for both a backgrounded MOBILE
 * BROWSER TAB and a switched-away desktop tab, which is what "a phone
 * left open on the slate overnight" (the brief's own framing) actually
 * exercises — plain `focus`/`blur` misses the mobile-background case
 * on some platforms.
 */
export interface FocusResyncHandle {
  stop: () => void;
}

export function startFocusResync(ping: () => Promise<unknown>): FocusResyncHandle {
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      // Best-effort: a failed resync ping just means the NEXT real API
      // call's own timing updates the clock instead (see
      // api/client.ts) — never block or throw into the caller over a
      // transient failure here.
      ping().catch(() => {
        /* swallowed — see comment above */
      });
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    stop: () => document.removeEventListener("visibilitychange", handleVisibilityChange),
  };
}
