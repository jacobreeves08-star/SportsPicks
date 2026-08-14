import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { game } from "../db/schema.js";

/**
 * Rough, generous max real-world duration per sport (JAC-24) — not
 * scientific, just enough margin that a genuinely still-in-progress game
 * (extra innings, overtime, a long weather delay) doesn't false-alarm,
 * while a game that's actually stuck (provider stopped reporting a
 * final) gets caught. Shared by score-poll's staleness check and the
 * /health/data-freshness endpoint so both agree on what "stale" means.
 */
export const MAX_GAME_DURATION_HOURS: Record<string, number> = {
  nfl: 4.5,
  ncaaf: 4.5,
  nba: 3,
  ncaamb: 3,
  mlb: 4,
  nhl: 3.5,
  epl: 2.5,
  ucl: 2.5,
  mls: 2.5,
  // A best-of-5 Grand Slam match can genuinely run 4-5 hours; generous
  // margin for rain/heat delays on top of that.
  tennis: 5,
  // A single fight is short, but ESPN's per-fight date reflects an
  // estimated start that late-running earlier fights on the same card
  // regularly blow past — margin for that, not just the fight itself.
  mma: 1.5,
};

export interface StaleGame {
  id: string;
  sport: string;
  startsAt: Date;
  status: string;
}

/**
 * Games that started long enough ago (per MAX_GAME_DURATION_HOURS for
 * their sport) that they should be final by now, but aren't — the
 * "dangerous failure" case: the job itself may be succeeding on every
 * run, but the data underneath it has quietly stopped moving.
 */
export async function findStaleGames(): Promise<StaleGame[]> {
  const nowMs = Date.now();

  const candidates = await db
    .select({ id: game.id, sport: game.sport, startsAt: game.startsAt, status: game.status })
    .from(game)
    .where(inArray(game.status, ["scheduled", "in_progress"]));

  return candidates.filter((g) => {
    const maxHours = MAX_GAME_DURATION_HOURS[g.sport];
    if (maxHours === undefined) return false; // unknown sport code — nothing to compare against
    const hoursSinceStart = (nowMs - g.startsAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceStart > maxHours;
  });
}
