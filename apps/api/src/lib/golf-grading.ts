import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * Golf's grading engine (JAC-56) — parallels lib/grading.ts, but with
 * one deliberate structural difference: a golf pick is scored (per the
 * confirmed design) as a single win/loss for the WHOLE tournament, and
 * is re-graded on every leaderboard poll while the tournament is live,
 * not graded once at the end. That means gradeGolfPicks below behaves
 * like grading.ts's regradeGame (unconditional overwrite), not like
 * gradeFinalGame's grade-once `outcome is null` guard — there is no
 * "first time" grading event for golf to guard against re-running.
 *
 * A pick is a win iff at least one of the member's selected golfers
 * currently sits at leaderboard position <= that league's golf_top_n
 * (per-league, read via the league_member -> league join, since the
 * same tournament can be picked across leagues with different
 * settings). `position` comes straight from ESPN's `order` field (see
 * lib/golf-provider.ts) — null (not yet posted) never counts as a top-N
 * finish.
 *
 * Callers are expected to only invoke this for a tournament that has
 * actually started (status in_progress/final) — same trust boundary as
 * gradeFinalGame, which never re-checks game.status itself either,
 * since the caller already knows that by construction. Grading a
 * scheduled tournament here would incorrectly grade every pick 'loss'
 * (no entry has a position yet).
 */
export async function gradeGolfPicks(tournamentId: string, executor: typeof db): Promise<void> {
  await executor.execute(sql`
    update golf_pick gp
    set outcome = case
        when exists (
          select 1
          from golf_pick_selection gps
          join tournament_entry te on te.id = gps.tournament_entry_id
          where gps.golf_pick_id = gp.id
            and te.position is not null
            and te.position <= l.golf_top_n
        ) then 'win'
        else 'loss'
      end,
      graded_at = now()
    from league_member lm
    join league l on l.id = lm.league_id
    where gp.league_member_id = lm.id
      and gp.tournament_id = ${tournamentId}
      and gp.outcome is distinct from 'void'
  `);
}

/**
 * Voids every non-void golf pick on a tournament — postponed/cancelled
 * tournaments are voided for everyone, same rule as voidGamePicks.
 * Idempotent the same way: re-running matches zero rows the second time.
 */
export async function voidTournamentPicks(tournamentId: string, executor: typeof db): Promise<void> {
  await executor.execute(sql`
    update golf_pick
    set outcome = 'void', graded_at = now()
    where tournament_id = ${tournamentId} and outcome is distinct from 'void'
  `);
}
