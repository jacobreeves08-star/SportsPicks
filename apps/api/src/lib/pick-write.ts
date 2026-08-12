import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game } from "../db/schema.js";
import { nowUtc } from "./time.js";

export type PickWriteRejectionReason =
  | "GAME_NOT_FOUND"
  | "GAME_NOT_IN_LEAGUE_SPORTS"
  | "GAME_CANCELED"
  | "GAME_POSTPONED"
  | "INVALID_TEAM_SELECTION"
  | "PICK_LOCKED";

export interface WrittenPick {
  id: string;
  leagueMemberId: string;
  gameId: string;
  selectedTeam: string;
  createdAt: Date;
}

export type PickWriteResult =
  | { accepted: true; pick: WrittenPick }
  | { accepted: false; reason: PickWriteRejectionReason; message: string };

/**
 * The one place a pick is ever written (JAC-31-36) — used by both the
 * single-pick route and the batch route, so there is exactly one
 * lock-enforcement implementation to get right, not two that could
 * drift apart. See docs/picks-and-locking.md for the full design.
 *
 * `executor` is `db` or a transaction handle (`typeof db` — matches the
 * existing `insertInviteCodeWithRetry(tx: typeof db, ...)` pattern in
 * leagues.routes.ts; Drizzle's transaction object is structurally the
 * same query-builder interface).
 *
 * Two-phase, deliberately: phase 1 pre-validates everything EXCEPT the
 * lock, in application code, using one already-fetched game row —
 * sport membership, status (canceled/postponed both block writes; a
 * postponed game's starts_at doesn't reliably mean anything until
 * schedule-ingest finds a real new time), and selectedTeam validity.
 * This is what keeps an invalid selection from ever reaching Postgres
 * and tripping check_pick_selected_team's own exception — critical for
 * the batch endpoint, where a thrown SQL error (not just a rejected
 * write) would abort the whole shared transaction. Phase 1's own
 * `now() >= startsAt` check is a fast-path courtesy only (skips a
 * round trip for an obviously-locked game) — it is NOT the enforcement.
 *
 * Phase 2 is the one real enforcement point: a single atomic statement
 * that re-reads starts_at fresh as part of the very same statement (so
 * a game rescheduled between requests locks at the NEW time, and the
 * two are never evaluated as of different moments), upserts, and logs
 * the write to pick_audit_log — all as chained writable CTEs. Verified
 * empirically against real Postgres (not just assumed) that: (a) the
 * unreferenced `logged` CTE still executes as a required side effect,
 * (b) `(xmax = 0)` correctly distinguishes insert from update, (c) a
 * failing lock gate produces zero rows and zero audit-log rows. This
 * relies on Postgres's default READ COMMITTED isolation (never
 * overridden anywhere in this app) so each statement in a multi-write
 * transaction — the batch endpoint's loop — sees fresh data.
 */
export async function writePick(
  executor: typeof db,
  params: { leagueMemberId: string; gameId: string; selectedTeam: string; leagueSports: string[] },
): Promise<PickWriteResult> {
  const { leagueMemberId, gameId, selectedTeam, leagueSports } = params;

  const [gameRow] = await executor.select().from(game).where(eq(game.id, gameId)).limit(1);

  if (!gameRow) {
    return { accepted: false, reason: "GAME_NOT_FOUND", message: "Game not found" };
  }
  if (!leagueSports.includes(gameRow.sport)) {
    return {
      accepted: false,
      reason: "GAME_NOT_IN_LEAGUE_SPORTS",
      message: "This game's sport is not part of the league",
    };
  }
  if (gameRow.status === "canceled") {
    return { accepted: false, reason: "GAME_CANCELED", message: "This game was canceled" };
  }
  if (gameRow.status === "postponed") {
    return {
      accepted: false,
      reason: "GAME_POSTPONED",
      message: "This game was postponed — picks reopen once a new time is set",
    };
  }
  const validSelections = gameRow.allowsDraw
    ? [gameRow.homeTeam, gameRow.awayTeam, "DRAW"]
    : [gameRow.homeTeam, gameRow.awayTeam];
  if (!validSelections.includes(selectedTeam)) {
    return {
      accepted: false,
      reason: "INVALID_TEAM_SELECTION",
      message: `selectedTeam must be one of: ${validSelections.join(", ")}`,
    };
  }
  if (nowUtc().toJSDate() >= gameRow.startsAt) {
    return { accepted: false, reason: "PICK_LOCKED", message: "Picking has closed for this game" };
  }

  const result = await executor.execute<{
    id: string;
    league_member_id: string;
    game_id: string;
    selected_team: string;
    created_at: Date;
    was_insert: boolean;
  }>(sql`
    with upserted as (
      insert into pick (league_member_id, game_id, selected_team)
      select ${leagueMemberId}, ${gameId}, ${selectedTeam}
      where exists (
        select 1 from game
        where id = ${gameId} and starts_at > now() and status not in ('canceled', 'postponed')
      )
      on conflict (league_member_id, game_id) do update set selected_team = excluded.selected_team
      returning id, league_member_id, game_id, selected_team, created_at, (xmax = 0) as was_insert
    ),
    logged as (
      insert into pick_audit_log (league_member_id, game_id, selected_team, action)
      select league_member_id, game_id, selected_team, case when was_insert then 'create' else 'change' end
      from upserted
      returning id
    )
    select u.* from upserted u, logged l
  `);

  const row = result.rows[0];
  if (!row) {
    // The only remaining explanation, since everything else was
    // pre-validated above: the game locked in the narrow window
    // between the fast-path check and this statement.
    return { accepted: false, reason: "PICK_LOCKED", message: "Picking has closed for this game" };
  }

  return {
    accepted: true,
    pick: {
      id: row.id,
      leagueMemberId: row.league_member_id,
      gameId: row.game_id,
      selectedTeam: row.selected_team,
      createdAt: row.created_at,
    },
  };
}
