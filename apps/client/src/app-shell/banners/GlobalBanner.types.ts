/**
 * The whole global-banner system, ONE type. At most one of these
 * renders at a time — `derive-global-banner.ts` is the single place
 * that decides which, so no screen improvises its own banner logic
 * (Epic 10 brief: "one system, not per-screen improvisation").
 */
export type GlobalBanner =
  | { kind: "offline" }
  /** Back online, but the offline queue (offline/queue.ts) may still
   * be actively flushing — distinct from steady-state "some picks are
   * queued" (`unsaved-picks`) because it's transient and in flight. */
  | { kind: "reconnecting" }
  /** The API itself looks unhealthy (a failed health ping, or a
   * tracked job that didn't succeed last run) — dominates everything
   * except being fully offline. */
  | { kind: "degraded" }
  /** `docs/app-shell.md`: no per-slate staleness signal exists on the
   * product API, so this is derived from polling the ops-only
   * `GET /health/data-freshness` directly. */
  | { kind: "stale"; asOf: string; reason?: string }
  | { kind: "unsaved-picks"; count: number };
