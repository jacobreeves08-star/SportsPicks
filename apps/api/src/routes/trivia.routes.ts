import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { triviaAnswer, triviaAttempt, triviaQuestion } from "../db/schema.js";
import { authenticate, optionalAuthenticate } from "../plugins/authenticate.js";
import { ApiError } from "../lib/http-errors.js";
import {
  QUESTIONS_PER_PUZZLE,
  getOrCreatePuzzle,
  gradeAnswer,
  questionBelongsToPuzzle,
  todayPuzzleDate,
  type PuzzleView,
} from "../lib/trivia-puzzle.js";
import { getTriviaStats } from "../lib/trivia-stats.js";

/**
 * The daily college quiz (docs/college-trivia.md): five NFL players
 * back to back, five colleges each, "which one did he attend?".
 *
 * Playable two ways, deliberately from the same endpoints rather than
 * a public and a private copy:
 *
 *  - **Logged out** — `optionalAuthenticate` lets the request through
 *    with no `request.user`. The puzzle is served and answers are
 *    graded exactly as they are for anyone else; nothing is persisted,
 *    and the response says so (`tracked: false`) rather than pretending.
 *  - **Logged in** — the same calls additionally open (or resume) a
 *    `trivia_attempt` and record each answer, which is what "one
 *    activation per day" and the profile metrics are built on.
 *
 * The correct answer is never in a GET response. `POST /answers` is
 * the only way to learn it, one question at a time, after committing
 * to a choice — see lib/trivia-puzzle.ts.
 */

interface AnsweredQuestionState {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
}

/** The caller's own progress on today's puzzle. Absent entirely for an
 * anonymous caller — there is nothing server-side to report. */
interface AttemptState {
  correctCount: number;
  answeredCount: number;
  completed: boolean;
  /** Already-answered questions, so a refresh mid-round resumes
   * exactly where it left off (including which ones were right)
   * instead of silently restarting a round the server won't let them
   * replay anyway. Correct answers for UNanswered questions are still
   * not included. */
  answers: AnsweredQuestionState[];
}

async function loadAttemptState(userId: string, puzzleId: string): Promise<AttemptState | null> {
  const [attempt] = await db
    .select()
    .from(triviaAttempt)
    .where(and(eq(triviaAttempt.userId, userId), eq(triviaAttempt.puzzleId, puzzleId)))
    .limit(1);

  if (!attempt) return null;

  const answers = await db
    .select({
      questionId: triviaAnswer.questionId,
      selectedIndex: triviaAnswer.selectedIndex,
      isCorrect: triviaAnswer.isCorrect,
      correctIndex: triviaQuestion.answerIndex,
    })
    .from(triviaAnswer)
    .innerJoin(triviaQuestion, eq(triviaAnswer.questionId, triviaQuestion.id))
    .where(eq(triviaAnswer.attemptId, attempt.id));

  return {
    correctCount: attempt.correctCount,
    answeredCount: attempt.answeredCount,
    completed: attempt.completedAt !== null,
    answers,
  };
}

function dailyResponse(puzzle: PuzzleView, attempt: AttemptState | null, tracked: boolean) {
  return {
    puzzleId: puzzle.id,
    date: puzzle.date,
    puzzleNumber: puzzle.puzzleNumber,
    questionCount: QUESTIONS_PER_PUZZLE,
    questions: puzzle.questions,
    // The client uses this to decide whether to show "Log in to track
    // your streak" — it is NOT a permission signal (an anonymous
    // caller can still play and be graded), just an honest statement
    // about whether this run is being saved anywhere.
    tracked,
    attempt,
  };
}

export async function triviaRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Today's puzzle. Public — this is the "trigger it from the home
   * page without logging in" path from the feature brief.
   *
   * Not cached via lib/slate-cache.ts despite being identical for
   * every anonymous caller: the response body differs per logged-in
   * user (`attempt`), and the read is two indexed queries against
   * five rows. Revisit if this ever shows up in the ops summary.
   */
  app.get("/daily", { preHandler: optionalAuthenticate }, async (request) => {
    const puzzle = await getOrCreatePuzzle(todayPuzzleDate());
    const userId = request.user?.id;

    if (!userId) return dailyResponse(puzzle, null, false);

    return dailyResponse(puzzle, await loadAttemptState(userId, puzzle.id), true);
  });

  /**
   * Answer one question. Public, same as `/daily` — an anonymous
   * caller is graded identically, just not recorded.
   *
   * Idempotent for a logged-in caller, and that's the whole enforcement
   * of "one activation per day": a second POST for a question already
   * answered returns the ORIGINAL answer untouched rather than
   * re-grading, so replaying the round can't improve a score. The
   * unique constraint on (attempt_id, question_id) is the backstop if
   * two requests race.
   */
  app.post(
    "/daily/answers",
    {
      preHandler: optionalAuthenticate,
      schema: {
        body: {
          type: "object",
          required: ["questionId", "selectedIndex"],
          properties: {
            questionId: { type: "string", format: "uuid" },
            selectedIndex: { type: "integer", minimum: 0, maximum: 4 },
          },
        },
      },
    },
    async (request) => {
      const { questionId, selectedIndex } = request.body as { questionId: string; selectedIndex: number };

      // Today's puzzle only. Without this, a stored questionId from any
      // past day could be graded (and, worse, recorded against today's
      // attempt) forever.
      const puzzle = await getOrCreatePuzzle(todayPuzzleDate());
      if (!(await questionBelongsToPuzzle(questionId, puzzle.id))) {
        throw new ApiError("NOT_FOUND", "That question isn't part of today's quiz", 404);
      }

      const graded = await gradeAnswer(questionId, selectedIndex);
      const userId = request.user?.id;

      if (!userId) {
        // `selectedIndex` echoed here too, not just on the logged-in
        // path below: the client marks the caller's own wrong choice
        // from it, and a guest who didn't get it back saw the right
        // answer highlighted with no indication of what THEY picked.
        return { ...graded, selectedIndex, tracked: false, attempt: null };
      }

      const attempt = await recordAnswer(userId, puzzle.id, graded.questionId, selectedIndex, graded.correct);

      // Re-read rather than trusting `graded`: if this question was
      // already answered, the stored answer wins and the caller must
      // see THAT, not the choice they just tried to make.
      const stored = attempt.answers.find((a) => a.questionId === questionId);
      return {
        questionId,
        correct: stored?.isCorrect ?? graded.correct,
        correctIndex: graded.correctIndex,
        correctCollege: graded.correctCollege,
        selectedIndex: stored?.selectedIndex ?? selectedIndex,
        tracked: true,
        attempt,
      };
    },
  );

  /** The caller's own metrics — streaks, accuracy, perfect days, the
   * recent-days strip. Authenticated (unlike the two routes above):
   * there is no such thing as an anonymous visitor's history. */
  app.get("/me/stats", { preHandler: authenticate }, async (request) => {
    return getTriviaStats(request.user!.id);
  });
}

/**
 * Opens the attempt if today is the caller's first question, records
 * the answer, and keeps the running tallies in step — all in one
 * transaction so a crash can't leave `answered_count` disagreeing with
 * the `trivia_answer` rows.
 */
async function recordAnswer(
  userId: string,
  puzzleId: string,
  questionId: string,
  selectedIndex: number,
  isCorrect: boolean,
): Promise<AttemptState> {
  await db.transaction(async (tx) => {
    await tx.insert(triviaAttempt).values({ userId, puzzleId }).onConflictDoNothing();

    const [attempt] = await tx
      .select()
      .from(triviaAttempt)
      .where(and(eq(triviaAttempt.userId, userId), eq(triviaAttempt.puzzleId, puzzleId)))
      .limit(1);

    if (!attempt) throw new ApiError("INTERNAL_ERROR", "Could not open a quiz attempt", 500);

    const inserted = await tx
      .insert(triviaAnswer)
      .values({ attemptId: attempt.id, questionId, selectedIndex, isCorrect })
      .onConflictDoNothing()
      .returning({ id: triviaAnswer.id });

    // Already answered — leave the tallies exactly as they are. This is
    // the "can't replay to improve your score" guarantee.
    if (inserted.length === 0) return;

    const answeredCount = attempt.answeredCount + 1;
    const correctCount = attempt.correctCount + (isCorrect ? 1 : 0);

    await tx
      .update(triviaAttempt)
      .set({
        answeredCount,
        correctCount,
        completedAt: answeredCount >= QUESTIONS_PER_PUZZLE ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(triviaAttempt.id, attempt.id));
  });

  const state = await loadAttemptState(userId, puzzleId);
  if (!state) throw new ApiError("INTERNAL_ERROR", "Could not read the quiz attempt back", 500);
  return state;
}
