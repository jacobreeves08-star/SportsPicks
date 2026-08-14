import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { golfPick, golfPickSelection, tournament, tournamentEntry } from "../db/schema.js";
import { logEvent } from "./analytics.js";
import { ApiError } from "./http-errors.js";
import { invalidateLeague } from "./slate-cache.js";
import { nowUtc } from "./time.js";

export type GolfPickWriteRejectionReason =
  | "GOLF_NOT_IN_LEAGUE_SPORTS"
  | "TOURNAMENT_NOT_FOUND"
  | "TOURNAMENT_CANCELED"
  | "TOURNAMENT_POSTPONED"
  | "WRONG_SELECTION_COUNT"
  | "DUPLICATE_GOLFER_SELECTION"
  | "UNKNOWN_GOLFER"
  | "GOLF_PICK_LOCKED";

export interface WrittenGolfPick {
  id: string;
  leagueMemberId: string;
  tournamentId: string;
  golferExternalIds: string[];
}

export type GolfPickWriteResult =
  | { accepted: true; pick: WrittenGolfPick }
  | { accepted: false; reason: GolfPickWriteRejectionReason; message: string };

/**
 * Golf's equivalent of lib/pick-write.ts's writePick — the one place a
 * golf pick is ever written. Deliberately simpler than the game
 * pick-write path in three ways: no pick-horizon concept (a member can
 * pick a tournament as soon as it's ingested — see docs/sports-pipeline.md),
 * no audit-trail table (out of scope for this pass — see 0013_golf.sql),
 * and unrestricted golfer overlap across members (confirmed design), so
 * there's no "is this golfer already taken" check at all, unlike a
 * two-sided game pick where both sides are always available anyway.
 *
 * Still two-phase for the same reason writePick is: phase 1
 * pre-validates everything except the lock using already-fetched rows
 * (fast-path courtesy); the lock itself is re-checked fresh inside a
 * transaction, since a tournament's starts_at is the one thing that can
 * newly fail between phase 1 and phase 2 as real time advances.
 *
 * A pick is a full replace, not a merge: changing your golfers before
 * the tournament starts deletes the old golf_pick_selection rows and
 * inserts the new set. This can never race with grading in a way that
 * matters — grading only ever reads picks for tournaments that have
 * already started, and a write here is only ever accepted for a
 * tournament that hasn't.
 */
export async function writeGolfPick(
  executor: typeof db,
  params: {
    leagueId: string;
    leagueMemberId: string;
    tournamentId: string;
    golferExternalIds: string[];
    leagueSports: string[];
    golfPickCount: number;
  },
): Promise<GolfPickWriteResult> {
  const { leagueId, leagueMemberId, tournamentId, golferExternalIds, leagueSports, golfPickCount } = params;

  if (!leagueSports.includes("golf")) {
    return {
      accepted: false,
      reason: "GOLF_NOT_IN_LEAGUE_SPORTS",
      message: "Golf is not part of this league",
    };
  }

  const [tournamentRow] = await executor.select().from(tournament).where(eq(tournament.id, tournamentId)).limit(1);
  if (!tournamentRow) {
    return { accepted: false, reason: "TOURNAMENT_NOT_FOUND", message: "Tournament not found" };
  }
  if (tournamentRow.status === "canceled") {
    return { accepted: false, reason: "TOURNAMENT_CANCELED", message: "This tournament was canceled" };
  }
  if (tournamentRow.status === "postponed") {
    return {
      accepted: false,
      reason: "TOURNAMENT_POSTPONED",
      message: "This tournament was postponed — picks reopen once a new time is set",
    };
  }

  if (golferExternalIds.length !== golfPickCount) {
    return {
      accepted: false,
      reason: "WRONG_SELECTION_COUNT",
      message: `Pick exactly ${golfPickCount} golfer${golfPickCount === 1 ? "" : "s"}`,
    };
  }
  if (new Set(golferExternalIds).size !== golferExternalIds.length) {
    return { accepted: false, reason: "DUPLICATE_GOLFER_SELECTION", message: "Each golfer can only be picked once" };
  }
  if (nowUtc().toJSDate() >= tournamentRow.startsAt) {
    return { accepted: false, reason: "GOLF_PICK_LOCKED", message: "Picking has closed for this tournament" };
  }

  const entries = await executor
    .select({ id: tournamentEntry.id, externalId: tournamentEntry.externalId })
    .from(tournamentEntry)
    .where(eq(tournamentEntry.tournamentId, tournamentId));
  const entryIdByExternalId = new Map(entries.map((e) => [e.externalId, e.id]));

  const resolvedEntryIds: string[] = [];
  for (const externalId of golferExternalIds) {
    const entryId = entryIdByExternalId.get(externalId);
    if (!entryId) {
      return { accepted: false, reason: "UNKNOWN_GOLFER", message: `Unknown golfer for this tournament: ${externalId}` };
    }
    resolvedEntryIds.push(entryId);
  }

  const writtenPickId = await executor.transaction(async (tx) => {
    // Re-read fresh, inside the transaction — the same "the lock is
    // the one thing that can newly fail" reasoning as writePick.
    const [freshTournament] = await tx
      .select({ startsAt: tournament.startsAt })
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);
    if (!freshTournament || nowUtc().toJSDate() >= freshTournament.startsAt) {
      return null;
    }

    const [gp] = await tx
      .insert(golfPick)
      .values({ leagueMemberId, tournamentId })
      .onConflictDoUpdate({
        target: [golfPick.leagueMemberId, golfPick.tournamentId],
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: golfPick.id });

    await tx.delete(golfPickSelection).where(eq(golfPickSelection.golfPickId, gp!.id));
    await tx.insert(golfPickSelection).values(resolvedEntryIds.map((entryId) => ({ golfPickId: gp!.id, tournamentEntryId: entryId })));

    return gp!.id;
  });

  if (!writtenPickId) {
    return { accepted: false, reason: "GOLF_PICK_LOCKED", message: "Picking has closed for this tournament" };
  }

  invalidateLeague(leagueId);
  await logEvent("pick_submitted", { leagueId, leagueMemberId, metadata: { tournamentId, sport: "golf" } });

  return {
    accepted: true,
    pick: { id: writtenPickId, leagueMemberId, tournamentId, golferExternalIds },
  };
}

export function rejectionToApiError(
  reason: GolfPickWriteRejectionReason,
  message: string,
  field: "tournamentId" | "golferExternalIds",
): ApiError {
  switch (reason) {
    case "GOLF_NOT_IN_LEAGUE_SPORTS":
    case "TOURNAMENT_NOT_FOUND":
    case "UNKNOWN_GOLFER":
      return new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [{ field, message }]);
    case "WRONG_SELECTION_COUNT":
    case "DUPLICATE_GOLFER_SELECTION":
      return new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [{ field: "golferExternalIds", message }]);
    case "TOURNAMENT_CANCELED":
      return new ApiError("GOLF_TOURNAMENT_CANCELED", message, 409);
    case "TOURNAMENT_POSTPONED":
      return new ApiError("GOLF_TOURNAMENT_POSTPONED", message, 409);
    case "GOLF_PICK_LOCKED":
      return new ApiError("GOLF_PICK_LOCKED", message, 409);
  }
}
