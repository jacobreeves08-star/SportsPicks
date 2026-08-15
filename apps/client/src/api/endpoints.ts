/**
 * Typed, endpoint-specific wrappers over `apiFetch` — one function per
 * row of docs/client-api-contract.md's endpoint catalog. Screens
 * (Epics 9-11) and the query/mutation hooks in this epic call THESE,
 * never `apiFetch` directly, so every call site gets the exact request/
 * response shape checked at compile time instead of re-typing a path
 * string and a generic per call site.
 */
import { apiFetch } from "./client.js";
import type {
  AuditLogEntry,
  AuthTokens,
  BatchPickResponse,
  CorrectResultResponse,
  CreatedLeague,
  GolfCurrentResponse,
  HeadToHeadResponse,
  InviteCodeDetail,
  InvitePreview,
  JoinedLeague,
  LeagueHomeEntry,
  LeagueMember,
  LeagueMemberReport,
  LeagueWithMemberCount,
  MessageResponse,
  NotificationPreferenceResponse,
  OpsSummary,
  DailyTrivia,
  Paginated,
  ResultsDigestResponse,
  SlateResponse,
  StandingsResponse,
  StandingsTimeframe,
  TriviaAnswerResponse,
  TriviaStats,
  UpdateProfileResponse,
  UserProfile,
  WrittenGolfPick,
  WrittenPick,
} from "./types.js";

// ---- Auth ----------------------------------------------------------

export function signup(body: {
  email: string;
  password: string;
  displayName: string;
  timezone: string;
}): Promise<MessageResponse> {
  return apiFetch("/auth/signup", { method: "POST", auth: false, body });
}

export function login(body: { email: string; password: string }): Promise<AuthTokens> {
  return apiFetch("/auth/login", { method: "POST", auth: false, body });
}

export function logout(): Promise<MessageResponse> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export function logoutAll(): Promise<MessageResponse> {
  return apiFetch("/auth/logout-all", { method: "POST" });
}

export function verifyEmail(token: string): Promise<MessageResponse> {
  return apiFetch("/auth/verify-email", { auth: false, query: { token } });
}

export function verifyEmailChange(token: string): Promise<MessageResponse> {
  return apiFetch("/auth/verify-email-change", { auth: false, query: { token } });
}

export function requestPasswordReset(email: string): Promise<MessageResponse> {
  return apiFetch("/auth/password-reset/request", { method: "POST", auth: false, body: { email } });
}

export function confirmPasswordReset(body: { token: string; newPassword: string }): Promise<MessageResponse> {
  return apiFetch("/auth/password-reset/confirm", { method: "POST", auth: false, body });
}

// ---- Users -----------------------------------------------------------

export function getMe(): Promise<UserProfile> {
  return apiFetch("/users/me");
}

export function updateMe(body: { displayName?: string; avatarUrl?: string; timezone?: string }): Promise<UpdateProfileResponse> {
  return apiFetch("/users/me", { method: "PATCH", body });
}

export function requestEmailChange(newEmail: string): Promise<MessageResponse> {
  return apiFetch("/users/me/email", { method: "POST", body: { newEmail } });
}

/** The global notifications off switch (Epic 10 — added alongside the
 * client that first needed it; see docs/notifications.md). */
export function updateGlobalNotifications(enabled: boolean): Promise<NotificationPreferenceResponse> {
  return apiFetch("/users/me/notifications", { method: "PATCH", body: { enabled } });
}

export function changePassword(body: { currentPassword: string; newPassword: string }): Promise<MessageResponse> {
  return apiFetch("/users/me/change-password", { method: "POST", body });
}

export function requestAccountDeletion(): Promise<MessageResponse & { scheduledDeletionAt: string }> {
  return apiFetch("/users/me/deletion-request", { method: "POST" });
}

export function cancelAccountDeletion(): Promise<MessageResponse> {
  return apiFetch("/users/me/deletion-cancel", { method: "POST" });
}

/** The caller's own "yesterday" record per league — see
 * docs/notifications.md's `GET /users/me/results-digest` section. */
export function getResultsDigest(): Promise<ResultsDigestResponse> {
  return apiFetch("/users/me/results-digest");
}

// ---- Leagues -----------------------------------------------------------

export function createLeague(body: {
  name: string;
  sports: string[];
  timezone?: string;
  seasonStart: string;
  pickHorizonDays?: number;
  golfPickCount?: number;
  golfTopN?: number;
}): Promise<CreatedLeague> {
  return apiFetch("/leagues", { method: "POST", body });
}

/** The multi-league home screen — a bare array, pre-sorted server-side.
 * See docs/client-api-contract.md. */
export function getMyLeagues(): Promise<LeagueHomeEntry[]> {
  return apiFetch("/leagues");
}

export function getLeague(leagueId: string): Promise<LeagueWithMemberCount> {
  return apiFetch(`/leagues/${leagueId}`);
}

export function updateLeague(
  leagueId: string,
  body: { name?: string; sports?: string[]; pickHorizonDays?: number; golfPickCount?: number; golfTopN?: number },
): Promise<LeagueWithMemberCount> {
  return apiFetch(`/leagues/${leagueId}`, { method: "PATCH", body });
}

/** The one tournament to show right now — not date-scoped like the
 * slate, since golf has at most one relevant event in flight at a time.
 * See docs/sports-pipeline.md. */
export function getCurrentGolf(leagueId: string): Promise<GolfCurrentResponse> {
  return apiFetch(`/leagues/${leagueId}/golf/current`);
}

/** A full replace of the member's golfer selections for the tournament,
 * not an incremental add — must be exactly `golfPickCount` golfers. */
export function putGolfPick(
  leagueId: string,
  memberId: string,
  tournamentId: string,
  golferExternalIds: string[],
): Promise<WrittenGolfPick> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}/golf-pick/${tournamentId}`, {
    method: "PUT",
    body: { golferExternalIds },
  });
}

export function deleteLeague(leagueId: string): Promise<void> {
  return apiFetch(`/leagues/${leagueId}`, { method: "DELETE" });
}

export function transferCommissioner(leagueId: string, newCommissionerMemberId: string): Promise<MessageResponse> {
  return apiFetch(`/leagues/${leagueId}/transfer-commissioner`, { method: "POST", body: { newCommissionerMemberId } });
}

export function leaveLeague(leagueId: string): Promise<MessageResponse> {
  return apiFetch(`/leagues/${leagueId}/leave`, { method: "POST" });
}

export function removeMember(leagueId: string, memberId: string): Promise<void> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}`, { method: "DELETE" });
}

export function getMembers(leagueId: string, params: { limit?: number; cursor?: string } = {}): Promise<Paginated<LeagueMember>> {
  return apiFetch(`/leagues/${leagueId}/members`, { query: params });
}

export function reportMember(leagueId: string, memberId: string, reason: string): Promise<LeagueMemberReport> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}/report`, { method: "POST", body: { reason } });
}

/** The per-league notification preference (Epic 10). Distinct from
 * `updateGlobalNotifications` — the global switch is checked first
 * server-side and short-circuits regardless of this one. */
export function updateLeagueNotifications(
  leagueId: string,
  memberId: string,
  enabled: boolean,
): Promise<NotificationPreferenceResponse> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}/notifications`, { method: "PATCH", body: { enabled } });
}

export function getReports(leagueId: string): Promise<LeagueMemberReport[]> {
  return apiFetch(`/leagues/${leagueId}/reports`);
}

export function getAuditLog(
  leagueId: string,
  params: { limit?: number; cursor?: string; gameId?: string; memberId?: string } = {},
): Promise<Paginated<AuditLogEntry>> {
  return apiFetch(`/leagues/${leagueId}/audit-log`, { query: params });
}

// ---- Picks and the slate --------------------------------------------------

export function writePick(
  leagueId: string,
  memberId: string,
  gameId: string,
  selectedTeam: string,
): Promise<WrittenPick> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}/picks/${gameId}`, {
    method: "PUT",
    body: { selectedTeam },
  });
}

export function writePicksBatch(
  leagueId: string,
  memberId: string,
  picks: Array<{ gameId: string; selectedTeam: string }>,
): Promise<BatchPickResponse> {
  return apiFetch(`/leagues/${leagueId}/members/${memberId}/picks/batch`, {
    method: "POST",
    body: { picks },
  });
}

export function getSlate(leagueId: string, date?: string): Promise<SlateResponse> {
  return apiFetch(`/leagues/${leagueId}/slate`, { query: { date } });
}

// ---- Standings and head-to-head --------------------------------------------

export function getStandings(
  leagueId: string,
  params: { timeframe?: StandingsTimeframe; date?: string } = {},
): Promise<StandingsResponse> {
  return apiFetch(`/leagues/${leagueId}/standings`, { query: params });
}

export function getHeadToHead(leagueId: string, date?: string): Promise<HeadToHeadResponse> {
  return apiFetch(`/leagues/${leagueId}/head-to-head`, { query: { date } });
}

export function correctResult(
  leagueId: string,
  gameId: string,
  body: { winningTeam: string; reason: string },
): Promise<CorrectResultResponse> {
  return apiFetch(`/leagues/${leagueId}/games/${gameId}/correct-result`, { method: "POST", body });
}

export function getCorrections(leagueId: string, params: { limit?: number; cursor?: string } = {}): Promise<Paginated<unknown>> {
  return apiFetch(`/leagues/${leagueId}/corrections`, { query: params });
}

// ---- Invite codes --------------------------------------------------------

export function getInviteCode(leagueId: string): Promise<InviteCodeDetail> {
  return apiFetch(`/leagues/${leagueId}/invite-code`);
}

export function updateInviteCode(
  leagueId: string,
  body: { rotate?: boolean; maxUses?: number | null; expiresAt?: string | null },
): Promise<InviteCodeDetail> {
  return apiFetch(`/leagues/${leagueId}/invite-code`, { method: "PATCH", body });
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return apiFetch("/leagues/preview", { query: { code } });
}

export function joinLeague(code: string): Promise<JoinedLeague> {
  return apiFetch("/leagues/join", { method: "POST", body: { code } });
}

// ---- Health (unauthenticated, used by time/focus-resync.ts's ping) --------

export function pingHealth(): Promise<{ status: string }> {
  return apiFetch("/health", { auth: false });
}

/** Ops-only per docs/observability.md, but public/unauthenticated by
 * design — "the hook a future stale-data banner would poll." That
 * banner is this epic's app-shell/banners/, see docs/app-shell.md. */
export function getDataFreshness(): Promise<OpsSummary> {
  return apiFetch("/health/data-freshness", { auth: false });
}

// ---- Daily college trivia (playable logged-out) --------------------------

/** `auth: false` is wrong here and deliberately NOT used: the endpoint
 * is optionally-authenticated, so the token must be sent WHEN there is
 * one (that's what makes the round get tracked) and simply omitted
 * when there isn't. `apiFetch`'s default already does exactly that —
 * it attaches the header only if a token exists. */
export function getDailyTrivia(): Promise<DailyTrivia> {
  return apiFetch("/trivia/daily");
}

export function answerDailyTrivia(body: {
  questionId: string;
  selectedIndex: number;
}): Promise<TriviaAnswerResponse> {
  return apiFetch("/trivia/daily/answers", { method: "POST", body });
}

export function getTriviaStats(): Promise<TriviaStats> {
  return apiFetch("/trivia/me/stats");
}
