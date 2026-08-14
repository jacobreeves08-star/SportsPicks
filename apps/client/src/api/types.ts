/**
 * Wire types for the shipped API — see docs/client-api-contract.md,
 * the ground truth this file is written against. Every timestamp field
 * is typed `string` (ISO-8601 UTC as it comes over the wire), never
 * `Date` — parsing into a `Date` (and, for anything lock-related, into
 * the corrected server-clock time — see src/time/) is each consumer's
 * job, not something baked into the wire type.
 */

// ---- Auth ----------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface MessageResponse {
  message: string;
}

// ---- Users -----------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  pendingEmail: string | null;
  deletionRequestedAt: string | null;
  scheduledDeletionAt: string | null;
  createdAt: string;
  /** The global notifications switch (Epic 10) — the read-side
   * complement to `PATCH /users/me/notifications`. There is
   * DELIBERATELY no per-league equivalent on any read endpoint yet —
   * see `docs/app-shell.md`. */
  notificationsEnabled: boolean;
}

export interface UpdateProfileResponse extends UserProfile {
  warning?: string;
}

export interface NotificationPreferenceResponse {
  notificationsEnabled: boolean;
}

// ---- Ops / health (GET /health/data-freshness — public, unauthenticated,
// ops-only per docs/observability.md, but polled directly by the app
// shell's stale/degraded banners — see docs/app-shell.md for why) ------

export interface JobRunStatus {
  jobName: string;
  lastRunAt: string | null;
  lastRunSucceeded: boolean | null;
  lastSuccessAt: string | null;
}

export interface LeagueSlateCompletion {
  leagueId: string;
  leagueName: string;
  totalMembers: number;
  completedCount: number;
  rate: number | null;
}

export interface OpsSummary {
  jobs: JobRunStatus[];
  staleGameCount: number;
  correctionsLast24h: number;
  signupsLast24h: number;
  picksLast24h: number;
  slateCompletionRates: LeagueSlateCompletion[];
  generatedAt: string;
}

// ---- Leagues -----------------------------------------------------------

export interface League {
  id: string;
  name: string;
  sports: string[];
  commissionerId: string;
  timezone: string;
  seasonStart: string;
  /** How many days ahead a member can see a game as pickable — bounds
   * both the home screen's `unpickedCount` and the actual pick-write
   * enforcement server-side (a write beyond this rejects with
   * `PICK_NOT_YET_OPEN`). Commissioner-configurable, 1-30, default 7. */
  pickHorizonDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeagueWithMemberCount extends League {
  memberCount: number;
}

export interface CreatedLeague extends LeagueWithMemberCount {
  inviteCode: string;
}

/** `GET /leagues` — the multi-league home screen, pre-sorted server-side
 * (open-picks-first, soonest lock first; settled leagues trail
 * alphabetically). Deliberately NOT the paginated envelope — a bare
 * array, per the contract doc. */
export interface LeagueHomeEntry {
  id: string;
  name: string;
  sports: string[];
  memberCount: number;
  record: { wins: number; losses: number };
  gamesParticipated: number;
  rank: number;
  unpickedCount: number;
  nextLockAt: string | null;
  /** The caller's own membership id for this league (Epic 10) — lets
   * a client address `/:leagueId/members/:memberId/...` routes
   * (picks, notifications) without a second round trip. */
  leagueMemberId: string;
}

export interface LeagueMember {
  id: string;
  userId: string;
  displayName: string;
  role: "commissioner" | "member";
  joinedAt: string;
}

export interface LeagueMemberReport {
  id: string;
  leagueId: string;
  reporterLeagueMemberId: string;
  reportedLeagueMemberId: string;
  reason: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  leagueMemberId: string;
  displayName: string;
  gameId: string;
  selectedTeam: string;
  action: "create" | "change";
  createdAt: string;
}

// ---- Pagination --------------------------------------------------------

export interface Paginated<T> {
  data: T[];
  pagination: { next_cursor: string | null; limit: number };
}

// ---- Invite codes --------------------------------------------------------

export interface InviteCodeDetail {
  code: string;
  /** Points at the API host as shipped, not a client host — see
   * docs/client-api-contract.md's "Known contract gaps." Don't
   * navigate to this verbatim from the client; build the route from
   * `code` via the client's own router instead. */
  deepLink: string;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
}

export interface InvitePreview {
  name: string;
  sports: string[];
  memberCount: number;
  alreadyMember: boolean;
}

export interface JoinedLeague {
  leagueId: string;
  leagueName: string;
}

// ---- Picks and the slate --------------------------------------------------

/** One game as it appears on a day's slate — see
 * docs/client-api-contract.md for the exact privacy rules baked into
 * `otherPicks`/`myPick`, and src/game-state/ for the derived,
 * viewer-independent GameState this shares a source with but is NOT
 * the same enum as `pickState`. */
export interface SlateGame {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogoUrl: string | null;
  awayTeamLogoUrl: string | null;
  startsAt: string;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  allowsDraw: boolean;
  winningTeam: string | null;
  /** Server-computed `now() >= startsAt` as of the response — a read,
   * not the enforcement. See src/time/ for why a client must not
   * treat this as authoritative once time has passed since the
   * response was generated. */
  locked: boolean;
  myPick: string | null;
  otherPicks: Array<{
    leagueMemberId: string;
    displayName: string;
    hasPicked: boolean;
    selectedTeam: string | null;
  }>;
  pickState: "unpicked" | "picked_open" | "locked" | "final_hit" | "final_miss";
}

export interface SlateResponse {
  date: string;
  games: SlateGame[];
  pickedCount: number;
  totalCount: number;
}

export interface WrittenPick {
  id: string;
  leagueMemberId: string;
  gameId: string;
  selectedTeam: string;
  createdAt: string;
}

export interface BatchPickResultItem {
  gameId: string;
  status: "accepted" | "rejected";
  pick?: { selectedTeam: string };
  error?: { code: string; message: string };
}

export interface BatchPickResponse {
  results: BatchPickResultItem[];
}

// ---- Standings and head-to-head --------------------------------------------

export type StandingsTimeframe = "today" | "week" | "season";

export interface StandingsEntry {
  leagueMemberId: string;
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  gamesParticipated: number;
  winPct: number;
  rank: number;
  rankChange: number | null;
}

export interface StandingsResponse {
  timeframe: StandingsTimeframe;
  date: string;
  callerLeagueMemberId: string;
  standings: StandingsEntry[];
}

export interface HeadToHeadPick {
  leagueMemberId: string;
  displayName: string;
  selectedTeam: string | null;
  hit: boolean | null;
}

export interface HeadToHeadGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  winningTeam: string | null;
  picks: HeadToHeadPick[];
  split: boolean;
  allWrong: boolean;
}

export interface HeadToHeadResponse {
  date: string;
  games: HeadToHeadGame[];
}

export interface ResultCorrection {
  id: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  oldWinningTeam: string;
  newWinningTeam: string;
  source: "manual" | "provider_revision";
  correctedByUserId: string | null;
  correctedFromLeagueId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CorrectResultResponse {
  correction: ResultCorrection;
  affectedMembers: Array<{
    leagueMemberId: string;
    oldOutcome: "win" | "loss" | "void" | null;
    newOutcome: "win" | "loss" | "void" | null;
  }>;
}

// ---- Results digest ---------------------------------------------------

/** One league's entry in `GET /users/me/results-digest` — the caller's
 * own record for "yesterday" in that league. `date` is per-entry
 * (rather than one shared date on the response) since different
 * leagues' timezones can resolve "yesterday" to different calendar
 * dates for the same instant. */
export interface ResultsDigestEntry {
  leagueId: string;
  leagueName: string;
  date: string;
  wins: number;
  losses: number;
  gamesParticipated: number;
  rank: number;
}

/** A league is simply absent here (never a zeroed-out entry) when the
 * caller had no graded games there yesterday. */
export interface ResultsDigestResponse {
  leagues: ResultsDigestEntry[];
}
