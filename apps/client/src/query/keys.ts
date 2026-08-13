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
};
