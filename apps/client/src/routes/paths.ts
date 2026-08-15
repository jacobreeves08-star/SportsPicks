import type { StandingsTimeframe } from "../api/types.js";

/**
 * Pure, framework-independent path builders for every route in
 * route-tree.ts — kept separate from the router itself so anything
 * that needs to construct one of these URLs (a "copy invite link"
 * action, a deep-link handler reacting to a push notification, a
 * test) doesn't need a mounted router instance or React at all. These
 * are the canonical shapes; route-tree.ts's route definitions are
 * this module's only real "spec compliance" dependency — if one
 * changes, the other must too, which is exactly why both live in this
 * directory.
 */

export function homePath(): string {
  return "/";
}

export function profilePath(): string {
  return "/profile";
}

/** Public — playable with no account at all, and the URL a shared
 * result sends a friend to. Not under `/leagues/...` because the
 * daily quiz belongs to no league. */
export function collegeQuizPath(): string {
  return "/college-quiz";
}

export function loginPath(returnTo?: string): string {
  return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
}

export function signupPath(returnTo?: string): string {
  return returnTo ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup";
}

/** Authenticated — a sibling of `homePath`/`profilePath` under
 * `authenticatedLayoutRoute`, not a public route like `/join`. */
export function createLeaguePath(): string {
  return "/leagues/new";
}

export function passwordResetRequestPath(): string {
  return "/password-reset";
}

export function passwordResetConfirmPath(token?: string): string {
  return token ? `/password-reset/confirm?token=${encodeURIComponent(token)}` : "/password-reset/confirm";
}

export function verifyEmailPath(token?: string): string {
  return token ? `/verify-email?token=${encodeURIComponent(token)}` : "/verify-email";
}

export function verifyEmailChangePath(token?: string): string {
  return token ? `/verify-email-change?token=${encodeURIComponent(token)}` : "/verify-email-change";
}

export function joinPath(inviteCode: string): string {
  return `/join/${encodeURIComponent(inviteCode)}`;
}

export function slatePath(leagueId: string, date: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/slate/${encodeURIComponent(date)}`;
}

/** No `date` segment — resolves to "today" server-side via
 * `slateIndexRoute`'s redirect (route-tree.tsx). Prefer `slatePath`
 * whenever a date is already known (e.g. switching leagues while
 * already viewing a specific day) — this path always costs at least
 * one extra redirect hop. */
export function slateIndexPath(leagueId: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/slate`;
}

export function standingsPath(leagueId: string, range: StandingsTimeframe = "today"): string {
  return `/leagues/${encodeURIComponent(leagueId)}/standings?range=${range}`;
}

export function headToHeadPath(leagueId: string, date: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/head-to-head/${encodeURIComponent(date)}`;
}

/** Commissioner-only (`LeagueSettingsScreen` itself enforces this — a
 * non-commissioner landing here via a stale link sees a message, not a
 * crash). */
export function leagueSettingsPath(leagueId: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/settings`;
}

/** No date segment, unlike `slatePath` — golf has at most one relevant
 * tournament in flight at a time, resolved server-side. */
export function golfPath(leagueId: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/golf`;
}
