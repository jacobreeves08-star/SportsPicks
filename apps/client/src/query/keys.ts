/**
 * Centralized query-key factory. Every query in this app gets its key
 * from here, never a hand-typed array literal at the call site — this
 * is what keeps cache invalidation (Step 6's mutation hook invalidates
 * `queryKeys.slate(leagueId)` after an accepted pick write) correct by
 * construction instead of by every call site remembering the exact
 * shape.
 */
export const queryKeys = {
  me: () => ["users", "me"] as const,
  myLeagues: () => ["leagues"] as const,
  league: (leagueId: string) => ["leagues", leagueId] as const,
  /** `date` is the API's own optional param — omitted here (not
   * defaulted to a computed "today") means "whatever the server
   * resolves as today in the league's timezone," matching the
   * endpoint's own default exactly rather than a client-side guess at
   * the league's timezone. */
  slate: (leagueId: string, date?: string) => ["leagues", leagueId, "slate", date ?? null] as const,
  standings: (leagueId: string, timeframe?: string, date?: string) =>
    ["leagues", leagueId, "standings", timeframe ?? "today", date ?? null] as const,
  headToHead: (leagueId: string, date?: string) => ["leagues", leagueId, "head-to-head", date ?? null] as const,
  members: (leagueId: string) => ["leagues", leagueId, "members"] as const,
  auditLog: (leagueId: string) => ["leagues", leagueId, "audit-log"] as const,
  inviteCode: (leagueId: string) => ["leagues", leagueId, "invite-code"] as const,
  /** Epic 11 — the public/optionally-authenticated join preview
   * (`GET /leagues/preview?code=`), keyed by the invite code itself
   * rather than a leagueId (unknown until this resolves). */
  invitePreview: (code: string) => ["invite-preview", code] as const,
  /** Epic 10 — the global banner system's slow background poll. Not
   * scoped to any league (the underlying endpoint isn't either). */
  dataFreshness: () => ["health", "data-freshness"] as const,
  healthPing: () => ["health", "ping"] as const,
  /** The caller's own "yesterday, across every league" digest — not
   * scoped to any one league (the underlying endpoint isn't either). */
  resultsDigest: () => ["users", "me", "results-digest"] as const,
};
