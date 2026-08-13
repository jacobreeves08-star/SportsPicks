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

export function loginPath(returnTo?: string): string {
  return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
}

export function joinPath(inviteCode: string): string {
  return `/join/${encodeURIComponent(inviteCode)}`;
}

export function slatePath(leagueId: string, date: string): string {
  return `/leagues/${encodeURIComponent(leagueId)}/slate/${encodeURIComponent(date)}`;
}

export function standingsPath(leagueId: string, range: StandingsTimeframe = "today"): string {
  return `/leagues/${encodeURIComponent(leagueId)}/standings?range=${range}`;
}
