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
  HeadToHeadResponse,
  InviteCodeDetail,
  InvitePreview,
  JoinedLeague,
  LeagueHomeEntry,
  LeagueMember,
  LeagueMemberReport,
  LeagueWithMemberCount,
  MessageResponse,
  Paginated,
  SlateResponse,
  StandingsResponse,
  StandingsTimeframe,
  UpdateProfileResponse,
  UserProfile,
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

export function changePassword(body: { currentPassword: string; newPassword: string }): Promise<MessageResponse> {
  return apiFetch("/users/me/change-password", { method: "POST", body });
}

export function requestAccountDeletion(): Promise<MessageResponse & { scheduledDeletionAt: string }> {
  return apiFetch("/users/me/deletion-request", { method: "POST" });
}

export function cancelAccountDeletion(): Promise<MessageResponse> {
  return apiFetch("/users/me/deletion-cancel", { method: "POST" });
}

// ---- Leagues -----------------------------------------------------------

export function createLeague(body: {
  name: string;
  sports: string[];
  timezone?: string;
  seasonStart: string;
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

export function updateLeague(leagueId: string, body: { name?: string; sports?: string[] }): Promise<LeagueWithMemberCount> {
  return apiFetch(`/leagues/${leagueId}`, { method: "PATCH", body });
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
