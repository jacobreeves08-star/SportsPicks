import { DateTime } from "luxon";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { game, league } from "../db/schema.js";
import { logEvent } from "./analytics.js";
import { ApiError } from "./http-errors.js";
import { invalidateLeague } from "./slate-cache.js";
import { dayBoundsUtc, nowUtc } from "./time.js";

export type PickWriteRejectionReason =
  | "GAME_NOT_FOUND"
  | "GAME_NOT_IN_LEAGUE_SPORTS"
  | "GAME_CANCELED"
  | "GAME_POSTPONED"
  | "INVALID_TEAM_SELECTION"
  | "PICK_LOCKED"
  | "PICK_BEYOND_HORIZON";

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
 * `now() >= startsAt` AND `startsAt >= now() + pickHorizonDays` checks
 * are a fast-path courtesy only (skip a round trip for an obviously-
 * locked or obviously-too-far-out game) — neither is the enforcement.
 * The horizon bound can never newly fail between phase 1 and phase 2
 * (it only gets MORE permissive as real time advances, unlike the lock
 * bound, which can newly fail) — see the `if (!row)` fallback below.
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
  params: {
    leagueId: string;
    leagueMemberId: string;
    gameId: string;
    selectedTeam: string;
    leagueSports: string[];
    pickHorizonDays: number;
  },
): Promise<PickWriteResult> {
  const { leagueId, leagueMemberId, gameId, selectedTeam, leagueSports, pickHorizonDays } = params;

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
  // Same "fast-path courtesy only" caveat as the lock check above —
  // the real enforcement is phase 2's atomic SQL bound below, re-read
  // fresh at write time. Rolling window from now, not calendar-day
  // aligned (mirrors PICK_LOCKED's own "as of this instant" framing,
  // not a day-boundary concept the league's timezone would matter for).
  if (gameRow.startsAt >= nowUtc().plus({ days: pickHorizonDays }).toJSDate()) {
    return {
      accepted: false,
      reason: "PICK_BEYOND_HORIZON",
      message: `Picks for this game open within ${pickHorizonDays} day${pickHorizonDays === 1 ? "" : "s"} of kickoff`,
    };
  }

  // NOTE: db.execute()'s raw path returns timestamptz columns as
  // Postgres's text representation, not a JS Date (confirmed
  // empirically — see docs/scoring-and-standings.md's engineering
  // note) — created_at is converted below before it goes into the
  // response, so the wire format stays ISO-8601 per
  // docs/api-conventions.md's Timestamps convention.
  const result = await executor.execute<{
    id: string;
    league_member_id: string;
    game_id: string;
    selected_team: string;
    created_at: string;
    was_insert: boolean;
  }>(sql`
    with upserted as (
      insert into pick (league_member_id, game_id, selected_team)
      select ${leagueMemberId}, ${gameId}, ${selectedTeam}
      where exists (
        select 1 from game
        where id = ${gameId}
          and starts_at > now()
          and starts_at < now() + (${pickHorizonDays} * interval '1 day')
          and status not in ('canceled', 'postponed')
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

  // JAC-43-48: an accepted write must be reflected on the caller's very
  // next slate read regardless of the cache TTL — safe to call
  // unconditionally, even from a nested (batch-endpoint) transaction
  // that could still roll back on some later, unrelated failure: an
  // eviction is never wrong, only ever a wasted cache miss on the next
  // read, never stale-but-incorrect data.
  invalidateLeague(leagueId);

  // JAC-44: best-effort, never blocks the write above (logEvent
  // swallows its own errors) — pick_submitted always fires on accept;
  // slate_completed fires too, in the same call, the moment this
  // member has no unpicked non-postponed/cancelled game left in
  // today's slate (the league's timezone, matching every other
  // "what day is it" computation in this app).
  await logEvent("pick_submitted", { leagueId, leagueMemberId, metadata: { gameId } });
  const [leagueRow] = await executor.select({ timezone: league.timezone }).from(league).where(eq(league.id, leagueId)).limit(1);
  if (leagueRow) {
    const localDate = DateTime.fromJSDate(gameRow.startsAt, { zone: "utc" }).setZone(leagueRow.timezone).toISODate();
    if (localDate) {
      const { start, end } = dayBoundsUtc(localDate, leagueRow.timezone);
      const sportsSql = sql.join(
        leagueSports.map((s) => sql`${s}`),
        sql`, `,
      );
      const remaining = await executor.execute<{ count: string }>(sql`
        select count(*) as count from game g
        where g.sport in (${sportsSql})
          and g.starts_at >= ${start} and g.starts_at < ${end}
          and g.status not in ('postponed', 'canceled')
          and not exists (select 1 from pick p where p.game_id = g.id and p.league_member_id = ${leagueMemberId})
      `);
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        await logEvent("slate_completed", { leagueId, leagueMemberId, metadata: { date: localDate } });
      }
    }
  }

  return {
    accepted: true,
    pick: {
      id: row.id,
      leagueMemberId: row.league_member_id,
      gameId: row.game_id,
      selectedTeam: row.selected_team,
      createdAt: new Date(row.created_at),
    },
  };
}

/**
 * Shared mapping from a rejection reason to the HTTP-facing shape, used
 * by both the single-pick route (thrown as an ApiError) and the batch
 * route (embedded per-item, never thrown — see leagues.routes.ts and
 * docs/picks-and-locking.md). GAME_NOT_FOUND/GAME_NOT_IN_LEAGUE_SPORTS
 * reuse VALIDATION_ERROR (a malformed/invalid reference, same pattern
 * as transfer-commissioner's "must be an active member" check);
 * PICK_LOCKED/GAME_CANCELED/GAME_POSTPONED/INVALID_TEAM_SELECTION each
 * get their own top-level code — distinct business-rule rejections a
 * client should branch on differently, not just "bad input."
 */
export function rejectionToApiError(
  reason: PickWriteRejectionReason,
  message: string,
  field: "gameId" | "selectedTeam",
): ApiError {
  switch (reason) {
    case "GAME_NOT_FOUND":
    case "GAME_NOT_IN_LEAGUE_SPORTS":
      return new ApiError("VALIDATION_ERROR", "Request failed validation", 400, [{ field, message }]);
    case "INVALID_TEAM_SELECTION":
      return new ApiError("INVALID_TEAM_SELECTION", message, 400, [{ field, message }]);
    case "GAME_CANCELED":
      return new ApiError("GAME_CANCELED", message, 409);
    case "GAME_POSTPONED":
      return new ApiError("GAME_POSTPONED", message, 409);
    case "PICK_LOCKED":
      return new ApiError("PICK_LOCKED", message, 409);
    case "PICK_BEYOND_HORIZON":
      return new ApiError("PICK_NOT_YET_OPEN", message, 409);
  }
}
