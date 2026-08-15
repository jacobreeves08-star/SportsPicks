import { Link } from "@tanstack/react-router";
import type { TriviaDayResult } from "../../api/types.js";
import { ErrorState, NumericText, Spinner, Stack, Text } from "../../design-system/index.js";
import { useTriviaStats } from "../../query/hooks/use-daily-trivia.js";
import styles from "./TriviaStatsSection.module.css";

/**
 * The "metrics attached to their profile" half of the daily college
 * quiz (docs/college-trivia.md) — streak, accuracy, perfect days, and
 * a strip of recent scores.
 *
 * Authenticated-only by nature (there is no anonymous history), which
 * is fine here: this renders inside `ProfileScreen`, itself behind the
 * auth guard, so there is no logged-out case to handle.
 */
export function TriviaStatsSection() {
  const { data: stats, isLoading, isError, refetch } = useTriviaStats();

  return (
    <Stack gap={3}>
      <Stack direction="row" justify="between" align="center" gap={3} wrap>
        <Text as="h2" size="md" weight="bold">
          College Quiz
        </Text>
        <Link to="/college-quiz" className={styles.playLink}>
          Play today
        </Link>
      </Stack>

      {isLoading ? <Spinner label="Loading your quiz stats" /> : null}

      {isError ? <ErrorState message="Couldn't load your quiz stats." onRetry={() => void refetch()} /> : null}

      {stats && stats.daysPlayed === 0 ? (
        <Text color="dim" size="sm">
          You haven&rsquo;t played yet — five NFL players a day, one guess each.
        </Text>
      ) : null}

      {stats && stats.daysPlayed > 0 ? (
        <Stack gap={4}>
          <Stack direction="row" gap={3} wrap className={styles.metrics}>
            <Metric label="Current streak" value={stats.currentStreak} suffix={dayLabel(stats.currentStreak)} />
            <Metric label="Best streak" value={stats.bestStreak} suffix={dayLabel(stats.bestStreak)} />
            <Metric
              label="Accuracy"
              /* `accuracyPct` is null only when nothing has been
                 answered, which `daysPlayed > 0` already rules out —
                 the fallback is belt-and-braces, not an expected path. */
              value={stats.accuracyPct ?? 0}
              suffix="%"
            />
            <Metric label="Perfect days" value={stats.perfectDays} />
            <Metric label="Days played" value={stats.daysPlayed} />
            <Metric label="Correct" value={stats.totalCorrect} suffix={`of ${stats.totalAnswered}`} />
          </Stack>

          <Stack gap={2}>
            <Text size="sm" weight="medium" color="dim">
              Recent rounds
            </Text>
            <Stack as="ul" gap={1} className={styles.recentList}>
              {stats.recent.map((day: TriviaDayResult) => (
                <li key={day.date} className={styles.recentRow}>
                  <Text size="sm" color="dim">
                    #{day.puzzleNumber}
                  </Text>
                  <Text size="sm" color="dim" className={styles.recentDate}>
                    {day.date}
                  </Text>
                  <NumericText
                    size="sm"
                    weight="bold"
                    color={day.correctCount === day.answeredCount && day.completed ? "hit" : "default"}
                  >
                    {day.correctCount}/{day.answeredCount}
                  </NumericText>
                  {!day.completed ? (
                    <Text size="xs" color="dim">
                      unfinished
                    </Text>
                  ) : null}
                </li>
              ))}
            </Stack>
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <Stack gap={1} className={styles.metric}>
      <Stack direction="row" gap={1} align="end">
        <NumericText size="lg" weight="bold">
          {value}
        </NumericText>
        {suffix ? (
          <Text size="xs" color="dim">
            {suffix}
          </Text>
        ) : null}
      </Stack>
      <Text size="xs" color="dim">
        {label}
      </Text>
    </Stack>
  );
}

function dayLabel(count: number): string {
  return count === 1 ? "day" : "days";
}
