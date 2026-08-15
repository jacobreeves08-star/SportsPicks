import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { nflAthlete, triviaPuzzle, triviaQuestion } from "../db/schema.js";
import { ApiError } from "./http-errors.js";
import { logger } from "./logger.js";

/**
 * Builds (and then serves) the one daily puzzle: five NFL players, five
 * colleges each, one of them right. See docs/college-trivia.md.
 *
 * Two properties drive every decision in this file:
 *
 *  1. **Everyone gets the same five players on the same day.** A score
 *     is meant to be shared and compared ("I got 4/5"), which is only
 *     meaningful against an identical board. So a puzzle is built ONCE,
 *     persisted, and re-read forever after — never regenerated per
 *     request, and never per-viewer.
 *  2. **The correct answer never leaves the server before the user
 *     picks.** `trivia_question.answer_index` is deliberately absent
 *     from every read path here; `gradeAnswer` is the only way to
 *     learn it. Otherwise the whole feature is defeated by opening
 *     devtools.
 */

/**
 * The day boundary for "today's puzzle" — a single fixed anchor
 * timezone for the whole world, NOT the caller's `user.timezone` and
 * NOT a league's.
 *
 * This is a real departure from how the rest of this app decides what
 * day it is (a slate's day boundary is the LEAGUE's timezone, see
 * docs/picks-and-locking.md), and it's deliberate: those are scoped to
 * a league, this is global. If the puzzle rolled over per-viewer, two
 * friends in different timezones would be looking at different players
 * at the same instant, and the shared score this feature is built
 * around would be comparing nothing. America/New_York because it's the
 * NFL's own reference timezone.
 */
export const PUZZLE_TIMEZONE = "America/New_York";

/**
 * Day 1. Fixed forever — `puzzle_number` is persisted rather than
 * recomputed (see the migration), so moving this constant can never
 * renumber a puzzle somebody already shared; it only affects puzzles
 * built after the change.
 */
const PUZZLE_EPOCH = "2026-08-01";

export const QUESTIONS_PER_PUZZLE = 5;
export const OPTIONS_PER_QUESTION = 5;

/**
 * Positions a casual fan plausibly recognizes. Question selection
 * prefers these — a quiz made of practice-squad long snappers is
 * technically valid and completely unplayable. Not a hard filter: the
 * fallback below will happily use anyone rather than serve fewer than
 * five questions.
 *
 * Kickers are deliberately NOT here. They were originally, but outside
 * of two or three names even a STARTING kicker is obscure, and the
 * whole point of the preferred tiers is "players people have heard
 * of". They remain reachable through the any-active fallback tier.
 */
const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];

/**
 * How far back to look when avoiding repeats. Purely cosmetic — the
 * same player showing up twice in a fortnight isn't wrong, just dull.
 * Never allowed to starve the puzzle: if exclusion leaves too few
 * candidates, it's dropped (see `pickAthletes`).
 */
const REPEAT_LOOKBACK_DAYS = 30;

export function todayPuzzleDate(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: PUZZLE_TIMEZONE }).toISODate()!;
}

export function puzzleNumberFor(date: string): number {
  const start = DateTime.fromISO(PUZZLE_EPOCH, { zone: PUZZLE_TIMEZONE });
  const day = DateTime.fromISO(date, { zone: PUZZLE_TIMEZONE });
  return Math.floor(day.diff(start, "days").days) + 1;
}

/**
 * A tiny deterministic PRNG (mulberry32) seeded from the puzzle date,
 * so building the same date twice produces the same puzzle. `Math.random`
 * would work — the puzzle is persisted on first build and the unique
 * constraint settles any race — but determinism makes this testable
 * without stubbing globals, and makes a rebuild after a manual delete
 * reproduce what people already saw rather than silently diverge.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a supplied RNG — never mutates the input. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface PuzzleAthlete {
  id: string;
  displayName: string;
  positionAbbreviation: string | null;
  jersey: string | null;
  headshotUrl: string | null;
  teamDisplayName: string | null;
  collegeName: string;
}

/**
 * Four wrong colleges for one athlete, drawn from colleges that other
 * real NFL players actually attended — so every option is a plausible
 * football school, never filler. The correct answer is excluded by
 * name (not by athlete), which matters: two teammates from the same
 * school would otherwise let the right answer appear twice, making the
 * question unanswerable.
 */
export function buildOptions(
  correctCollege: string,
  collegePool: readonly string[],
  random: () => number,
): { options: string[]; answerIndex: number } {
  const candidates = collegePool.filter((c) => c !== correctCollege);
  const distractors = shuffle(candidates, random).slice(0, OPTIONS_PER_QUESTION - 1);

  if (distractors.length < OPTIONS_PER_QUESTION - 1) {
    throw new ApiError(
      "TRIVIA_POOL_TOO_SMALL",
      "Not enough distinct colleges in the player pool to build a question",
      503,
    );
  }

  const options = shuffle([correctCollege, ...distractors], random);
  return { options, answerIndex: options.indexOf(correctCollege) };
}

/**
 * Candidate athletes for one puzzle, best-first: depth-chart starters
 * at a recognizable position, then active roster at a recognizable
 * position, then active anyone, then literally anyone. Each tier is
 * only consulted if the tiers above it came up short, so a thin pool
 * degrades to a harder quiz rather than to no quiz.
 *
 * The starter tier exists because "active + skill position" alone
 * kept surfacing players nobody outside one fanbase has heard of — a
 * third-string RB matches that filter exactly as well as a franchise
 * QB. Being listed first in a depth-chart slot is the signal that
 * actually tracks recognizability (see nfl-athlete-provider.ts).
 */
async function pickAthletes(date: string, random: () => number): Promise<PuzzleAthlete[]> {
  const recentlyUsed = await recentlyUsedAthleteIds(date);

  const columns = {
    id: nflAthlete.id,
    displayName: nflAthlete.displayName,
    positionAbbreviation: nflAthlete.positionAbbreviation,
    jersey: nflAthlete.jersey,
    headshotUrl: nflAthlete.headshotUrl,
    teamDisplayName: nflAthlete.teamDisplayName,
    collegeName: nflAthlete.collegeName,
  };

  const tiers = [
    and(
      eq(nflAthlete.rosterStatus, "active"),
      eq(nflAthlete.isStarter, true),
      inArray(nflAthlete.positionAbbreviation, SKILL_POSITIONS),
    ),
    and(eq(nflAthlete.rosterStatus, "active"), inArray(nflAthlete.positionAbbreviation, SKILL_POSITIONS)),
    eq(nflAthlete.rosterStatus, "active"),
    undefined,
  ];

  const chosen: PuzzleAthlete[] = [];
  const takenIds = new Set<string>();

  for (const where of tiers) {
    if (chosen.length >= QUESTIONS_PER_PUZZLE) break;

    const rows = await db.select(columns).from(nflAthlete).where(where);
    // The repeat-avoidance filter is applied here, per tier, and NEVER
    // allowed to be the reason a puzzle comes up short — a later tier
    // (or the final `.filter(takenIds)` pass below) will reuse a
    // recent athlete before it will serve four questions.
    const fresh = shuffle(
      rows.filter((r) => !takenIds.has(r.id) && !recentlyUsed.has(r.id)),
      random,
    );

    for (const row of fresh) {
      if (chosen.length >= QUESTIONS_PER_PUZZLE) break;
      chosen.push(row);
      takenIds.add(row.id);
    }
  }

  if (chosen.length < QUESTIONS_PER_PUZZLE) {
    // Last resort: ignore repeat-avoidance entirely.
    const rows = await db.select(columns).from(nflAthlete);
    for (const row of shuffle(rows, random)) {
      if (chosen.length >= QUESTIONS_PER_PUZZLE) break;
      if (takenIds.has(row.id)) continue;
      chosen.push(row);
      takenIds.add(row.id);
    }
  }

  return chosen;
}

async function recentlyUsedAthleteIds(date: string): Promise<Set<string>> {
  const since = DateTime.fromISO(date, { zone: PUZZLE_TIMEZONE }).minus({ days: REPEAT_LOOKBACK_DAYS }).toISODate()!;
  const rows = await db
    .select({ athleteId: triviaQuestion.athleteId })
    .from(triviaQuestion)
    .innerJoin(triviaPuzzle, eq(triviaQuestion.puzzleId, triviaPuzzle.id))
    .where(gte(triviaPuzzle.puzzleDate, since));
  return new Set(rows.map((r) => r.athleteId));
}

async function collegePool(): Promise<string[]> {
  const rows = await db.selectDistinct({ collegeName: nflAthlete.collegeName }).from(nflAthlete);
  return rows.map((r) => r.collegeName);
}

export interface PuzzleQuestionView {
  id: string;
  position: number;
  athlete: {
    displayName: string;
    positionAbbreviation: string | null;
    jersey: string | null;
    headshotUrl: string | null;
    teamDisplayName: string | null;
  };
  /** The five colleges in fixed display order. Which one is right is
   * NOT here, by design — see this module's header. */
  options: string[];
}

export interface PuzzleView {
  id: string;
  date: string;
  puzzleNumber: number;
  questions: PuzzleQuestionView[];
}

/**
 * The puzzle for a date, building it on first request if it doesn't
 * exist yet. Lazy rather than cron-built on purpose: a puzzle that
 * only exists once a nightly job has run is a puzzle that's missing
 * entirely if that job failed, and this feature has no upstream
 * deadline to respect (unlike score-poll) — the only input is a player
 * pool that changes weekly at most.
 *
 * Concurrency-safe without a lock: two simultaneous first-requests
 * both try to insert, `trivia_puzzle.puzzle_date`'s unique constraint
 * rejects the loser, and the loser re-reads the winner's rows. That's
 * why the insert is `onConflictDoNothing` followed by an unconditional
 * re-read rather than a returning-clause read.
 */
export async function getOrCreatePuzzle(date: string): Promise<PuzzleView> {
  const existing = await readPuzzle(date);
  if (existing) return existing;

  await buildPuzzle(date);

  const built = await readPuzzle(date);
  if (!built) {
    // Only reachable if the pool is empty — buildPuzzle throws for
    // that case, so this is a genuine "should never happen".
    throw new ApiError("TRIVIA_UNAVAILABLE", "Today's quiz could not be built", 503);
  }
  return built;
}

async function buildPuzzle(date: string): Promise<void> {
  const random = seededRandom(date);
  const athletes = await pickAthletes(date, random);

  if (athletes.length < QUESTIONS_PER_PUZZLE) {
    // The player pool hasn't been ingested yet (a fresh database, or a
    // first deploy before nfl-athlete-ingest has run). A 503 with a
    // distinct code, not a 500: nothing is broken, the data just isn't
    // there yet, and the client shows "check back soon" rather than an
    // error state.
    throw new ApiError(
      "TRIVIA_UNAVAILABLE",
      "The NFL player pool hasn't been loaded yet — run the nfl-athlete-ingest job",
      503,
    );
  }

  const pool = await collegePool();

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(triviaPuzzle)
      .values({ puzzleDate: date, puzzleNumber: puzzleNumberFor(date) })
      .onConflictDoNothing()
      .returning({ id: triviaPuzzle.id });

    const puzzleId = inserted[0]?.id;
    // Lost the race — the winner's questions are already committed (or
    // about to be), so do nothing and let the caller re-read.
    if (!puzzleId) {
      logger.info({ date }, "trivia: puzzle built concurrently, using the existing one");
      return;
    }

    await tx.insert(triviaQuestion).values(
      athletes.map((athlete, i) => {
        const { options, answerIndex } = buildOptions(athlete.collegeName, pool, random);
        return { puzzleId, position: i + 1, athleteId: athlete.id, options, answerIndex };
      }),
    );
  });
}

async function readPuzzle(date: string): Promise<PuzzleView | null> {
  const [puzzle] = await db.select().from(triviaPuzzle).where(eq(triviaPuzzle.puzzleDate, date)).limit(1);
  if (!puzzle) return null;

  const rows = await db
    .select({
      id: triviaQuestion.id,
      position: triviaQuestion.position,
      options: triviaQuestion.options,
      displayName: nflAthlete.displayName,
      positionAbbreviation: nflAthlete.positionAbbreviation,
      jersey: nflAthlete.jersey,
      headshotUrl: nflAthlete.headshotUrl,
      teamDisplayName: nflAthlete.teamDisplayName,
    })
    .from(triviaQuestion)
    .innerJoin(nflAthlete, eq(triviaQuestion.athleteId, nflAthlete.id))
    .where(eq(triviaQuestion.puzzleId, puzzle.id))
    .orderBy(triviaQuestion.position);

  // A puzzle row with no questions can only exist if a build crashed
  // between the two inserts, which the transaction above prevents —
  // treat it as absent so the next request rebuilds rather than
  // serving an empty quiz.
  if (rows.length === 0) return null;

  return {
    id: puzzle.id,
    date: puzzle.puzzleDate,
    puzzleNumber: puzzle.puzzleNumber,
    questions: rows.map((r) => ({
      id: r.id,
      position: r.position,
      athlete: {
        displayName: r.displayName,
        positionAbbreviation: r.positionAbbreviation,
        jersey: r.jersey,
        headshotUrl: r.headshotUrl,
        teamDisplayName: r.teamDisplayName,
      },
      options: r.options,
    })),
  };
}

export interface GradedAnswer {
  questionId: string;
  correct: boolean;
  correctIndex: number;
  correctCollege: string;
}

/**
 * The ONLY path by which a correct answer becomes knowable. Pure read +
 * compare; persistence (for a logged-in user) is the route's job, not
 * this function's, so an anonymous visitor gets graded by exactly the
 * same code as a logged-in one.
 */
export async function gradeAnswer(questionId: string, selectedIndex: number): Promise<GradedAnswer> {
  const [question] = await db
    .select({
      id: triviaQuestion.id,
      options: triviaQuestion.options,
      answerIndex: triviaQuestion.answerIndex,
    })
    .from(triviaQuestion)
    .where(eq(triviaQuestion.id, questionId))
    .limit(1);

  if (!question) {
    throw new ApiError("NOT_FOUND", "Question not found", 404);
  }

  return {
    questionId: question.id,
    correct: selectedIndex === question.answerIndex,
    correctIndex: question.answerIndex,
    correctCollege: question.options[question.answerIndex]!,
  };
}

/** Guards `POST /trivia/answers` against grading a question from an old
 * puzzle — one activation per DAY means today's questions only. */
export async function questionBelongsToPuzzle(questionId: string, puzzleId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`1` })
    .from(triviaQuestion)
    .where(and(eq(triviaQuestion.id, questionId), eq(triviaQuestion.puzzleId, puzzleId)))
    .limit(1);
  return Boolean(row);
}

/** Most recent puzzles first — used only by the profile stats query's
 * "recent scores" strip. */
export async function recentPuzzleDates(limit: number): Promise<string[]> {
  const rows = await db
    .select({ puzzleDate: triviaPuzzle.puzzleDate })
    .from(triviaPuzzle)
    .orderBy(desc(triviaPuzzle.puzzleDate))
    .limit(limit);
  return rows.map((r) => r.puzzleDate);
}
