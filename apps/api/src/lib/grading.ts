import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * The grading engine (JAC-37-42) — see docs/scoring-and-standings.md
 * for the full design, including exactly which write paths call each
 * of these and why. Every function here writes `pick.outcome`/
 * `graded_at` once, at write time, so standings never re-derive a
 * pick's outcome from `result` on every read.
 *
 * `executor` is `db` or a transaction handle (matches the established
 * `typeof db` pattern already used by writePick() and
 * insertInviteCodeWithRetry()).
 */

/**
 * Grades every ungraded pick on a game against the winning team.
 * Idempotent by construction: the `outcome is null` guard means a
 * second call for the same game matches zero rows — "grading twice
 * cannot double-count" isn't enforced by a lock or a separate check,
 * it falls directly out of this WHERE clause. Called from score-poll's
 * exactly-once final-transition block, in the same transaction as the
 * result insert.
 */
export async function gradeFinalGame(gameId: string, winningTeam: string, executor: typeof db): Promise<void> {
  await executor.execute(sql`
    update pick
    set outcome = case when selected_team = ${winningTeam} then 'win' else 'loss' end,
        graded_at = now()
    where game_id = ${gameId} and outcome is null
  `);
}

/**
 * Voids every ungraded pick on a game — postponed/cancelled games are
 * voided for everyone, never counted as a loss, per the scoring rules.
 * Idempotent the same way as gradeFinalGame. Called from three places:
 * score-poll's non-final branch (when a candidate's status becomes
 * postponed/cancelled), schedule-ingest's per-sport upsert follow-up,
 * and the reconciliation sweep — see docs/scoring-and-standings.md for
 * why cancelled games specifically needed that third path.
 */
export async function voidGamePicks(gameId: string, executor: typeof db): Promise<void> {
  await executor.execute(sql`
    update pick
    set outcome = 'void', graded_at = now()
    where game_id = ${gameId} and outcome is null
  `);
}

/**
 * Re-grades EVERY win/loss pick on a game against a NEW winning team —
 * deliberately without the `outcome is null` guard, since a correction
 * is specifically about overwriting an already-graded outcome. Used
 * only by the result-correction flow (automatic provider-revision
 * detection and the manual commissioner tool), never by normal
 * first-time grading.
 *
 * Never touches an already-`void`ed pick — void is terminal for a
 * given pick (the game was postponed/cancelled when it happened), and
 * a result correction has no bearing on that; only win/loss outcomes
 * are ever revised.
 */
export async function regradeGame(gameId: string, winningTeam: string, executor: typeof db): Promise<void> {
  await executor.execute(sql`
    update pick
    set outcome = case when selected_team = ${winningTeam} then 'win' else 'loss' end,
        graded_at = now()
    where game_id = ${gameId} and (outcome is null or outcome in ('win', 'loss'))
  `);
}
