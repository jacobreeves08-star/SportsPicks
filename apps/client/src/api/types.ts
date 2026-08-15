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
  /** How many golfers a member picks per tournament (1-10, default 3),
   * and how far down the leaderboard still counts as a correct pick
   * (1-50, default 10). Only meaningful for a league whose `sports`
   * includes "golf". Commissioner-configurable. */
  golfPickCount: number;
  golfTopN: number;
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
  homeTeamColor: string | null;
  awayTeamColor: string | null;
  /** Country flag for an individual-sport competitor (MMA, tennis) —
   * the provider's stand-in for a crest, which a person never has. A
   * side has at most one of logo/flag, never both. */
  homeTeamFlagUrl: string | null;
  awayTeamFlagUrl: string | null;
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

// ---- Golf ------------------------------------------------------------------

/** Golf doesn't use the slate/PickControl model at all — a tournament is
 * a ~69-competitor leaderboard, not a 2-sided matchup, so it gets its
 * own endpoint and its own screen. See docs/sports-pipeline.md. */
export interface GolfTournament {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  /** Server-computed `now() >= startsAt` as of the response — same
   * read-not-enforcement caveat as SlateGame.locked. */
  locked: boolean;
}

export interface GolfLeaderboardEntry {
  externalId: string;
  golferName: string;
  /** Country flag URL — the only image a golfer has, since an
   * individual competitor has no crest. Null when the provider omits
   * it, in which case the row renders name-only. */
  flagUrl: string | null;
  /** Live leaderboard rank (1 = leader). Null until the provider posts
   * one — never treated as a top-N finish. */
  position: number | null;
}

export interface GolfCurrentResponse {
  tournament: GolfTournament | null;
  leaderboard: GolfLeaderboardEntry[];
  /** The caller's own selections, always visible. Null if they haven't
   * picked this tournament. */
  myPick: string[] | null;
  otherPicks: Array<{
    leagueMemberId: string;
    displayName: string;
    hasPicked: boolean;
    /** Null until the tournament locks — same privacy rule as the
     * slate's `otherPicks[].selectedTeam`. */
    golferExternalIds: string[] | null;
  }>;
  golfPickCount: number;
  golfTopN: number;
}

export interface WrittenGolfPick {
  id: string;
  leagueMemberId: string;
  tournamentId: string;
  golferExternalIds: string[];
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

// ---- Daily college trivia ---------------------------------------------

/** One question's player. `headshotUrl` is ESPN's CDN URL and may be
 * null — the card falls back to name-only, never a broken image. */
export interface TriviaAthlete {
  displayName: string;
  positionAbbreviation: string | null;
  jersey: string | null;
  headshotUrl: string | null;
  teamDisplayName: string | null;
}

/** Deliberately has NO "correct answer" field — the server never sends
 * one with the question (see the API's routes/trivia.routes.ts). The
 * only way to learn it is to POST an answer, which is what stops the
 * quiz being solvable from the network tab. */
export interface TriviaQuestion {
  id: string;
  position: number;
  athlete: TriviaAthlete;
  options: string[];
}

export interface TriviaAnsweredQuestion {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
}

/** The caller's server-side progress on today's puzzle. `null` for a
 * logged-out visitor — there is nothing saved for them. */
export interface TriviaAttempt {
  correctCount: number;
  answeredCount: number;
  completed: boolean;
  answers: TriviaAnsweredQuestion[];
}

export interface DailyTrivia {
  puzzleId: string;
  date: string;
  puzzleNumber: number;
  questionCount: number;
  questions: TriviaQuestion[];
  /** Whether this run is being SAVED, not whether it's allowed — a
   * logged-out visitor plays and is graded exactly the same, they just
   * get nothing recorded. Drives the "log in to track your streak"
   * nudge, nothing else. */
  tracked: boolean;
  attempt: TriviaAttempt | null;
}

export interface TriviaAnswerResponse {
  questionId: string;
  correct: boolean;
  correctIndex: number;
  correctCollege: string;
  /** Always present, and echoed back rather than assumed because it
   * can DIFFER from what was just submitted: a replayed answer
   * returns the originally STORED choice, not the new one. */
  selectedIndex: number;
  tracked: boolean;
  attempt: TriviaAttempt | null;
}

export interface TriviaDayResult {
  date: string;
  puzzleNumber: number;
  correctCount: number;
  answeredCount: number;
  completed: boolean;
}

export interface TriviaStats {
  daysPlayed: number;
  currentStreak: number;
  bestStreak: number;
  totalCorrect: number;
  totalAnswered: number;
  /** null (not 0) when nothing has been answered yet — "no data" and
   * "0% accuracy" are different and render differently. */
  accuracyPct: number | null;
  perfectDays: number;
  recent: TriviaDayResult[];
}
