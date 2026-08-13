/**
 * Server-time sync (Epic 8, do-this-first per the brief — everything
 * else depends on it). Lock enforcement is entirely server-side
 * (docs/picks-and-locking.md), but the UI still needs to DISPLAY an
 * accurate countdown to it. If a countdown runs off `Date.now()`, a
 * user whose device clock is fast sees "3:47 left" on a game the
 * server already locked, or sees 0:00 on a game still genuinely open.
 *
 * Every API response carries `X-Server-Time` (apps/api/src/app.ts,
 * added this epic — see docs/client-api-contract.md), an ISO-8601 UTC
 * instant captured at the moment the server sent the response. This
 * module turns that header, plus the request's own round-trip timing,
 * into a corrected clock — `correctedNow()` — that the REST of this
 * client uses instead of `Date.now()` for anything lock-related.
 *
 * Framework/DOM-agnostic on purpose: this file has no dependency on
 * `window`/`document`/React, so it's trivially unit-testable and
 * reusable from the fetch client, a React hook, or a future non-React
 * surface without dragging any of those in. `time/focus-resync.ts`
 * wires the DOM `visibilitychange` concern on top; `time/use-clock.ts`
 * wires the React concern on top. Neither is this file's job.
 */

export interface ClockSyncSample {
  /** Milliseconds to ADD to `Date.now()` to get the corrected time.
   * Positive means the server is ahead of this device's clock. */
  offsetMs: number;
  /** This device's `Date.now()` at the moment the sample was recorded —
   * i.e. how fresh this sync is, for staleness checks. */
  syncedAt: number;
  /** Total request round-trip time this sample was derived from —
   * exposed for diagnostics/telemetry, not required for correctness. */
  roundTripMs: number;
}

let latest: ClockSyncSample | null = null;
const listeners = new Set<(sample: ClockSyncSample) => void>();

/**
 * Records one sync sample from a single request/response pair.
 *
 * `requestStartedAt`/`responseReceivedAt` are THIS DEVICE's `Date.now()`
 * readings bracketing the request — the caller (the fetch client)
 * takes these, not this module, since only the caller knows exactly
 * when the network call started and when the response object became
 * available. `serverTimeIso` is the `X-Server-Time` header value.
 *
 * Classic NTP-style offset estimate: assumes the request and response
 * legs of the round trip take roughly equal time, so the server's
 * clock at the MOMENT THIS DEVICE RECEIVED THE RESPONSE is
 * approximately `serverTime + roundTrip/2` (the server's timestamp was
 * captured roughly one leg — half the round trip — before the
 * response arrived here). The offset is the gap between that estimate
 * and this device's own clock at the same moment. A naive
 * `serverTime - responseReceivedAt` (ignoring latency entirely) would
 * systematically under-correct by roughly one full network leg on
 * every sync, worse the slower the connection — exactly the failure
 * mode this module exists to avoid on real-world (bar-wifi-grade)
 * networks.
 */
export function recordClockSync(
  serverTimeIso: string,
  requestStartedAt: number,
  responseReceivedAt: number,
): ClockSyncSample {
  const serverTimeMs = Date.parse(serverTimeIso);
  if (Number.isNaN(serverTimeMs)) {
    throw new Error(`server-clock: could not parse X-Server-Time value "${serverTimeIso}"`);
  }

  const roundTripMs = Math.max(0, responseReceivedAt - requestStartedAt);
  const estimatedServerTimeAtResponse = serverTimeMs + roundTripMs / 2;
  const offsetMs = estimatedServerTimeAtResponse - responseReceivedAt;

  const sample: ClockSyncSample = { offsetMs, syncedAt: responseReceivedAt, roundTripMs };
  latest = sample;
  for (const listener of listeners) listener(sample);
  return sample;
}

/** The most recent sync sample, or null before the first successful
 * API response of this session. */
export function getClockSync(): ClockSyncSample | null {
  return latest;
}

/**
 * The corrected clock. Before any sync has happened, falls back to
 * this device's own `Date.now()` (offset 0) — a brand-new session has
 * no better information yet, and this is never worse than not
 * correcting at all. Every countdown and every client-side lock HINT
 * (never the enforcer — see docs/client-api-contract.md and
 * game-state/) in this app must call this, never `Date.now()` directly.
 */
export function correctedNow(): number {
  return Date.now() + (latest?.offsetMs ?? 0);
}

export function correctedDate(): Date {
  return new Date(correctedNow());
}

/** Subscribe to every new sync sample (a resync on refetch, on focus,
 * or from any other API call). Returns an unsubscribe function. */
export function onClockSync(listener: (sample: ClockSyncSample) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only reset — never call from application code. */
export function resetClockSyncForTests(): void {
  latest = null;
  listeners.clear();
}
