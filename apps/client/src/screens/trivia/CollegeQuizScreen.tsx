import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getAuthState } from "../../api/auth-store.js";
import { answerDailyTrivia } from "../../api/endpoints.js";
import { ApiError } from "../../api/errors.js";
import { MaybeShell } from "../../app-shell/MaybeShell.js";
import type { DailyTrivia, TriviaAnswerResponse, TriviaQuestion } from "../../api/types.js";
import { ErrorState, LoadingState, NumericText, Stack, Surface, Text } from "../../design-system/index.js";
import { queryKeys } from "../../query/keys.js";
import { useDailyTrivia } from "../../query/hooks/use-daily-trivia.js";
import { readGuestAttempt, recordGuestAnswer } from "../../trivia/guest-attempt-store.js";
import { TriviaShareButton } from "../../trivia/TriviaShareButton.js";
import { presentApiError } from "../present-api-error.js";
import styles from "./CollegeQuizScreen.module.css";

/**
 * The daily college quiz: five NFL players back to back, five colleges
 * each, "which one did he attend?".
 *
 * Reachable two ways, from ONE component — the feature brief asks for
 * a trigger on the home page with no login, and a trigger after login,
 * and making those two different screens would mean two things to keep
 * in step forever. This renders identically either way; the only
 * difference is where the answered round is stored:
 *
 *  - **Logged in** — the server owns it (`trivia_attempt`), so the
 *    round survives a refresh, a new device, and a cleared cache, and
 *    it feeds the profile metrics.
 *  - **Logged out** — `guest-attempt-store.ts` (localStorage) owns it,
 *    which is honest-but-unenforceable, and the screen says so rather
 *    than implying a streak is being kept.
 *
 * Grading is a server round trip in BOTH cases: the correct answer
 * isn't in the puzzle payload at all (see the API's
 * lib/trivia-puzzle.ts), so it can't be read out of the network tab
 * before the user commits.
 */
export function CollegeQuizPage() {
  // `MaybeShell`, not `authenticatedLayoutRoute`: `/college-quiz` has
  // to be reachable with no account (it's the URL a shared result
  // sends a friend to), while a logged-in visitor should still get
  // their nav chrome rather than a dead-end page.
  return (
    <MaybeShell>
      <CollegeQuizScreen />
    </MaybeShell>
  );
}

export function CollegeQuizScreen() {
  const { data, isLoading, isError, error, refetch } = useDailyTrivia();

  if (isLoading) return <LoadingState rows={4} label="Loading today's quiz" />;

  if (isError) {
    // A 503 here is "the player pool hasn't been ingested yet" —
    // nothing is broken and retrying won't help, so say that instead
    // of showing a generic failure with a Retry button that can't work.
    if (error instanceof ApiError && error.code === "TRIVIA_UNAVAILABLE") {
      return (
        <Surface variant="raised" radius="lg" padding={5}>
          <Stack gap={2} align="center">
            <Text as="h1" size="lg" weight="bold">
              No quiz today
            </Text>
            <Text color="dim">Today&rsquo;s players haven&rsquo;t been loaded yet. Check back soon.</Text>
          </Stack>
        </Surface>
      );
    }
    return <ErrorState message="Couldn't load today's quiz." onRetry={() => void refetch()} />;
  }

  if (!data) return <LoadingState rows={4} label="Loading today's quiz" />;

  // Keyed by puzzle so a day rollover (or a cache hit from yesterday)
  // remounts with fresh local state rather than carrying a stale round.
  return <QuizRound key={data.puzzleId} daily={data} />;
}

/** One answered question, from whichever store owns this round. */
interface AnswerRecord {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
}

function QuizRound({ daily }: { daily: DailyTrivia }) {
  const isAuthenticated = Boolean(getAuthState().accessToken);
  const queryClient = useQueryClient();

  // Seeded from whichever store owns this round, so a refresh
  // mid-round resumes where it left off instead of restarting a round
  // the server won't let them replay anyway.
  const [answers, setAnswers] = useState<AnswerRecord[]>(() =>
    daily.attempt ? daily.attempt.answers : readGuestAttempt(daily.puzzleId).answers,
  );

  /** The just-graded answer, held so the user actually SEES whether
   * they were right (and what the right answer was) before the round
   * moves on. Cleared by "Next", which is what advances the round —
   * auto-advancing would flash the reveal past someone reading it. */
  const [reveal, setReveal] = useState<TriviaAnswerResponse | null>(null);

  const mutation = useMutation({
    mutationFn: answerDailyTrivia,
    onSuccess: (response) => {
      setReveal(response);

      if (response.tracked && response.attempt) {
        setAnswers(response.attempt.answers);
        // The profile's metrics just changed — drop the cached copy so
        // navigating there shows this round, not the pre-round numbers.
        void queryClient.invalidateQueries({ queryKey: queryKeys.triviaStats() });
      } else {
        setAnswers(
          recordGuestAnswer(daily.puzzleId, {
            questionId: response.questionId,
            // The server echoes the STORED choice, which differs from
            // the one just submitted if this question was already
            // answered — trust its version, not the click.
            selectedIndex: response.selectedIndex,
            isCorrect: response.correct,
            correctIndex: response.correctIndex,
          }).answers,
        );
      }
    },
  });

  const answerByQuestionId = useMemo(() => new Map(answers.map((a) => [a.questionId, a])), [answers]);

  // "Back to back to back to back to back" — the round always sits on
  // the first UNanswered question (no skipping around), and lands on
  // the result card once all five are done.
  const nextIndex = daily.questions.findIndex((q) => !answerByQuestionId.has(q.id));

  // While a reveal is showing, stay on the question it belongs to
  // rather than jumping ahead — `answers` already contains it, so
  // `nextIndex` has moved on.
  const revealedIndex = reveal ? daily.questions.findIndex((q) => q.id === reveal.questionId) : -1;
  const currentIndex = revealedIndex !== -1 ? revealedIndex : nextIndex;

  const results = daily.questions.map((q) => answerByQuestionId.get(q.id)?.isCorrect ?? false);

  if (currentIndex === -1) {
    return <ResultCard daily={daily} results={results} isAuthenticated={isAuthenticated} />;
  }

  const question = daily.questions[currentIndex]!;
  const isLastQuestion = currentIndex === daily.questions.length - 1;

  return (
    <Stack gap={4} className={styles.screen}>
      <Header puzzleNumber={daily.puzzleNumber} tracked={daily.tracked} />

      <Stack direction="row" justify="between" align="center">
        <Text size="sm" color="dim" weight="medium">
          Question {currentIndex + 1} of {daily.questionCount}
        </Text>
        <NumericText size="sm" color="dim">
          {answers.filter((a) => a.isCorrect).length} correct
        </NumericText>
      </Stack>

      <ProgressPips
        total={daily.questionCount}
        results={daily.questions.map((q) => answerByQuestionId.get(q.id)?.isCorrect ?? null)}
      />

      <QuestionCard
        question={question}
        reveal={reveal}
        disabled={mutation.isPending}
        onAnswer={(selectedIndex) => mutation.mutate({ questionId: question.id, selectedIndex })}
      />

      {reveal ? (
        <button type="button" className={styles.nextButton} onClick={() => setReveal(null)}>
          {isLastQuestion ? "See your result" : "Next player"}
        </button>
      ) : null}

      {mutation.isError ? (
        <Text as="p" color="error" role="alert">
          {presentApiError(mutation.error).message}
        </Text>
      ) : null}
    </Stack>
  );
}

function Header({ puzzleNumber, tracked }: { puzzleNumber: number; tracked: boolean }) {
  return (
    <Stack gap={1}>
      <Text as="h1" size="xl" weight="bold" className={styles.title}>
        College Quiz
      </Text>
      <Stack direction="row" gap={2} align="center" wrap>
        <NumericText size="sm" color="dim">
          #{puzzleNumber}
        </NumericText>
        {!tracked ? (
          // Said up front, not after the round — someone about to build
          // a streak deserves to know it isn't being kept BEFORE they
          // play, not once they've finished.
          <Text size="xs" color="dim">
            · Playing as a guest —{" "}
            <Link to="/login" className={styles.inlineLink}>
              log in
            </Link>{" "}
            to track your streak
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

function ProgressPips({ total, results }: { total: number; results: (boolean | null)[] }) {
  return (
    <Stack direction="row" gap={1} aria-hidden="true" className={styles.pips}>
      {Array.from({ length: total }, (_, i) => {
        const result = results[i];
        const state = result === null || result === undefined ? "pending" : result ? "hit" : "miss";
        return <span key={i} className={`${styles.pip} ${styles[state]!}`} />;
      })}
    </Stack>
  );
}

function QuestionCard({
  question,
  reveal,
  disabled,
  onAnswer,
}: {
  question: TriviaQuestion;
  reveal: TriviaAnswerResponse | null;
  disabled: boolean;
  onAnswer: (selectedIndex: number) => void;
}) {
  const { athlete } = question;
  const subtitle = [athlete.positionAbbreviation, athlete.teamDisplayName].filter(Boolean).join(" · ");
  const isRevealed = reveal !== null && reveal.questionId === question.id;

  return (
    <Surface variant="raised" radius="lg" padding={5} elevation={2}>
      <Stack gap={4} align="center">
        {athlete.headshotUrl ? (
          <img
            src={athlete.headshotUrl}
            // Empty alt, not the player's name: the name is right below
            // as real text, and an alt naming him would announce the
            // same information twice.
            alt=""
            className={styles.headshot}
            // A dead CDN URL must degrade to "no photo", never a
            // broken-image icon in the middle of the question.
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}

        <Stack gap={1} align="center">
          <Text as="h2" size="xl" weight="bold" className={styles.playerName}>
            {athlete.displayName}
          </Text>
          {subtitle ? (
            <Text size="sm" color="dim">
              {subtitle}
            </Text>
          ) : null}
        </Stack>

        <Text as="p" size="sm" color="dim" className={styles.prompt}>
          Which college did he attend?
        </Text>

        {/* Plain buttons, not a radio group: each option is submitted
            the instant it's chosen (there is no separate "submit"),
            which is button semantics. Contrast with the design
            system's PickControl, which IS a radio group precisely
            because a pick stays changeable until lock. */}
        <Stack as="ul" gap={2} className={styles.options}>
          {question.options.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                className={`${styles.option} ${optionStateClass(index, reveal, isRevealed)}`}
                disabled={disabled || isRevealed}
                onClick={() => onAnswer(index)}
              >
                <span>{option}</span>
                {/* Never color alone (docs/accessibility-and-responsive.md)
                    — the check/cross carries the same meaning as the
                    green/red fill for anyone who can't distinguish them. */}
                {isRevealed && index === reveal.correctIndex ? (
                  <span className={styles.mark} aria-label="correct answer">
                    ✓
                  </span>
                ) : null}
                {isRevealed && index === reveal.selectedIndex && !reveal.correct ? (
                  <span className={styles.mark} aria-label="your answer, wrong">
                    ✕
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </Stack>

        {isRevealed ? (
          <Text as="p" role="status" weight="bold" color={reveal.correct ? "hit" : "miss"}>
            {reveal.correct ? "Correct!" : `Nope — ${athlete.displayName} went to ${reveal.correctCollege}.`}
          </Text>
        ) : null}
      </Stack>
    </Surface>
  );
}

function optionStateClass(index: number, reveal: TriviaAnswerResponse | null, isRevealed: boolean): string {
  if (!isRevealed || !reveal) return "";
  if (index === reveal.correctIndex) return styles.optionCorrect!;
  if (index === reveal.selectedIndex) return styles.optionWrong!;
  return styles.optionMuted!;
}

function ResultCard({
  daily,
  results,
  isAuthenticated,
}: {
  daily: DailyTrivia;
  results: boolean[];
  isAuthenticated: boolean;
}) {
  const correct = results.filter(Boolean).length;

  return (
    <Stack gap={4} className={styles.screen}>
      <Header puzzleNumber={daily.puzzleNumber} tracked={daily.tracked} />

      <Surface variant="raised" radius="lg" padding={5} elevation={2}>
        <Stack gap={4} align="center">
          <Text as="h2" size="lg" weight="bold">
            {scoreHeadline(correct, results.length)}
          </Text>

          <NumericText size="xl" weight="bold" color={correct === results.length ? "hit" : "default"}>
            {correct}/{results.length}
          </NumericText>

          <ProgressPips total={results.length} results={results} />

          {/* The pips above are aria-hidden decoration; this is the
              same information as real text. */}
          <Text size="sm" color="dim">
            {results.map((hit, i) => `Q${i + 1} ${hit ? "correct" : "wrong"}`).join(", ")}
          </Text>

          <TriviaShareButton puzzleNumber={daily.puzzleNumber} results={results} />

          {isAuthenticated ? (
            <Link to="/profile" className={styles.inlineLink}>
              See your stats
            </Link>
          ) : (
            <Text size="sm" color="dim">
              <Link to="/signup" className={styles.inlineLink}>
                Sign up
              </Link>{" "}
              to keep a streak and track your accuracy.
            </Text>
          )}

          <Text size="xs" color="dim">
            Come back tomorrow for five new players.
          </Text>
        </Stack>
      </Surface>
    </Stack>
  );
}

function scoreHeadline(correct: number, total: number): string {
  if (correct === total) return "Perfect round";
  if (correct === 0) return "Rough one";
  if (correct >= total - 1) return "So close";
  return "Nice work";
}
