import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { leagueMember } from "../db/schema.js";
import { ApiError } from "./http-errors.js";

/**
 * Reusable, DB-backed authorization guards (JAC-17 — "the important
 * part"). Every check here runs server-side against the database on
 * every call; there is no client-trusted state. Throw ApiError, which
 * server.ts's error handler turns into the standard error envelope.
 */

export async function requireLeagueMembership(userId: string, leagueId: string) {
  const [member] = await db
    .select()
    .from(leagueMember)
    .where(and(eq(leagueMember.userId, userId), eq(leagueMember.leagueId, leagueId)))
    .limit(1);

  if (!member) {
    throw new ApiError("FORBIDDEN", "Not a member of this league", 403);
  }

  return member;
}

export async function requireLeagueCommissioner(userId: string, leagueId: string) {
  const member = await requireLeagueMembership(userId, leagueId);

  if (member.role !== "commissioner") {
    throw new ApiError("FORBIDDEN", "Only the league commissioner can do this", 403);
  }

  return member;
}

/**
 * For routes that take an explicit :memberId in the URL (e.g. writing a
 * pick "as" a specific league_member) — confirms memberId both belongs
 * to leagueId AND is the caller's own membership row. 403s (not 404) on
 * mismatch: the caller is already an authenticated member of this
 * league probing a sibling member's ID, not a stranger fumbling around
 * a resource whose existence should stay unconfirmed.
 */
export async function requireOwnMembership(userId: string, leagueId: string, memberId: string) {
  const member = await requireLeagueMembership(userId, leagueId);

  if (member.id !== memberId) {
    throw new ApiError("FORBIDDEN", "Cannot act on another member's behalf", 403);
  }

  return member;
}
