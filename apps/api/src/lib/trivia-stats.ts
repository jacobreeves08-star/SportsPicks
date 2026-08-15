import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { triviaAttempt, triviaPuzzle } from "../db/schema.js";
import { PUZZLE_TIMEZONE, QUESTIONS_PER_PUZZLE, todayPuzzleDate } from "./trivia-puzzle.js";

/**
 * The "metrics attached to their profile" half of the daily college
 * quiz (docs/college-trivia.md) — computed from `trivia_attempt`, one
 * row per user per day, rather than aggregated over individual answers.
 *
 * Everything here is derived on read. No denormalized streak counter
 * lives on the user row: a streak is a function of WHICH DAYS have an
 * attempt, and a stored counter would need correcting every time the
 * definition of "played" moved, or repairing after any backfill. A
 * user's attempt history is at most one row per day, so this is a tiny
 * scan even years in.
 */

/** One day's line in the history strip. */
export interface TriviaDayResult {
  date: string;
  puzzleNumber: number;
  correctCount: number;
  answeredCount: number;
  completed: boolean;
}

export interface TriviaStats {
  daysPlayed: number;
  /** Consecutive days up to and including today — see `computeStreaks`
   * for exactly when "up to yesterday" still counts. */
  currentStreak: number;
  bestStreak: number;
  totalCorrect: number;
  totalAnswered: number;
  /** 0-100, rounded to one decimal. `null` (not 0) when nothing has
   * been answered yet — "no data" and "0% accuracy" are different
   * things and the profile renders them differently. */
  accuracyPct: number | null;
  /** Days where all five were right. The headline brag. */
  perfectDays: number;
  /** Most recent first, capped by the caller. */
  recent: TriviaDayResult[];
}

const RECENT_LIMIT = 14;

function previousDate(date: string): string {
  return DateTime.fromISO(date, { zone: PUZZLE_TIMEZONE }).minus({ days: 1 }).toISODate()!;
}

/**
 * Streaks over the set of dates a user actually played.
 *
 * "Played" means at least one answer landed that day, not a completed
 * five — someone whose browser died on question four showed up, and
 * punishing that by resetting a 40-day streak is the kind of thing
 * that makes people stop playing. Accuracy already measures how they
 * did; the streak measures that they turned up.
 *
 * The current streak counts back from TODAY, but tolerates today being
 * unplayed: until the day is over, a streak that ran through yesterday
 * is still alive, and showing it as 0 all morning would be wrong.
 */
export function computeStreaks(
  playedDates: readonly string[],
  today: string,
): { currentStreak: number; bestStreak: number } {
  const played = new Set(playedDates);

  let currentStreak = 0;
  // Start at today if it's played, otherwise at yesterday — the
  // "still alive, not yet played" case above. If neither is played the
  // streak is genuinely 0 and the loop below never runs.
  let cursor = played.has(today) ? today : previousDate(today);
  while (played.has(cursor)) {
    currentStreak++;
    cursor = previousDate(cursor);
  }

  // Best streak: walk the sorted dates once, breaking the run whenever
  // two adjacent dates aren't consecutive calendar days.
  const sorted = [...played].sort();
  let bestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous !== null && previousDate(date) === previous ? run + 1 : 1;
    previous = date;
    if (run > bestStreak) bestStreak = run;
  }

  return { currentStreak, bestStreak };
}

export async function getTriviaStats(userId: string, now: Date = new Date()): Promise<TriviaStats> {
  const rows = await db
    .select({
      date: triviaPuzzle.puzzleDate,
      puzzleNumber: triviaPuzzle.puzzleNumber,
      correctCount: triviaAttempt.correctCount,
      answeredCount: triviaAttempt.answeredCount,
      completedAt: triviaAttempt.completedAt,
    })
    .from(triviaAttempt)
    .innerJoin(triviaPuzzle, eq(triviaAttempt.puzzleId, triviaPuzzle.id))
    .where(eq(triviaAttempt.userId, userId))
    .orderBy(desc(triviaPuzzle.puzzleDate));

  const played = rows.filter((r) => r.answeredCount > 0);
  const { currentStreak, bestStreak } = computeStreaks(
    played.map((r) => r.date),
    todayPuzzleDate(now),
  );

  const totalCorrect = played.reduce((sum, r) => sum + r.correctCount, 0);
  const totalAnswered = played.reduce((sum, r) => sum + r.answeredCount, 0);

  return {
    daysPlayed: played.length,
    currentStreak,
    bestStreak,
    totalCorrect,
    totalAnswered,
    accuracyPct: totalAnswered === 0 ? null : Math.round((totalCorrect / totalAnswered) * 1000) / 10,
    perfectDays: played.filter((r) => r.correctCount === QUESTIONS_PER_PUZZLE).length,
    recent: played.slice(0, RECENT_LIMIT).map((r) => ({
      date: r.date,
      puzzleNumber: r.puzzleNumber,
      correctCount: r.correctCount,
      answeredCount: r.answeredCount,
      completed: r.completedAt !== null,
    })),
  };
}
