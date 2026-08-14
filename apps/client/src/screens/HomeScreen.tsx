import { Link } from "@tanstack/react-router";
import type { LeagueHomeEntry } from "../api/types.js";
import {
  Countdown,
  EmptyState,
  ErrorState,
  LoadingState,
  NumericText,
  Stack,
  Surface,
  Text,
} from "../design-system/index.js";
import { setCurrentLeagueId } from "../leagues/current-league-store.js";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import { useCorrectedNow } from "../time/use-clock.js";
import styles from "./HomeScreen.module.css";

function LeagueRow({ league, now }: { league: LeagueHomeEntry; now: number }) {
  const hasOpenPicks = league.unpickedCount > 0;
  const remainingMs = league.nextLockAt ? Date.parse(league.nextLockAt) - now : null;

  return (
    <li>
      <Link
        to="/leagues/$leagueId/slate"
        params={{ leagueId: league.id }}
        onClick={() => setCurrentLeagueId(league.id)}
        className={styles.row}
      >
        <Surface variant="raised" radius="md" padding={3} as="div" className={styles.rowSurface}>
          <Stack direction="row" justify="between" align="center" gap={3}>
            <Stack gap={1}>
              <Text weight="bold">{league.name}</Text>
              <Stack direction="row" gap={2}>
                <NumericText size="sm" color="dim">
                  {league.record.wins}-{league.record.losses}
                </NumericText>
                <NumericText size="sm" color="dim">
                  #{league.rank}
                </NumericText>
              </Stack>
            </Stack>
            <Stack gap={1} align="end">
              {hasOpenPicks ? (
                <>
                  <Stack direction="row" gap={1} align="center" className={styles.unpickedPill}>
                    <NumericText size="lg" weight="bold" color="open">
                      {league.unpickedCount}
                    </NumericText>
                    <Text size="xs" color="dim" weight="medium">
                      unpicked
                    </Text>
                  </Stack>
                  {remainingMs !== null && remainingMs > 0 ? (
                    <Countdown remainingMs={remainingMs} size="xs" color="open" />
                  ) : null}
                </>
              ) : (
                <Text size="sm" color="hit" weight="medium">
                  All picked
                </Text>
              )}
            </Stack>
          </Stack>
        </Surface>
      </Link>
    </li>
  );
}

/**
 * `homeRoute`'s component — "the retention screen" (Epic 11 brief):
 * every league the caller belongs to, unpicked-count MOST prominent,
 * ordered by urgency. That ordering is entirely server-side
 * (`GET /leagues`, `leagues.routes.ts`'s own comment: open-picks-first,
 * soonest-lock-within-that-group, settled leagues trail alphabetically)
 * — this screen renders in the order the response arrives, never
 * re-sorts. One tap from a row to that league's slate; the pick
 * control itself (Epic 11's next step) is the second tap the brief's
 * "two taps to act" refers to.
 */
export function HomeScreen() {
  const { data: leagues, isLoading, isError, refetch } = useMyLeagues();
  const now = useCorrectedNow(1000);

  if (isLoading) {
    return <LoadingState rows={3} label="Loading your leagues" />;
  }

  if (isError) {
    return <ErrorState message="Couldn't load your leagues." onRetry={() => void refetch()} />;
  }

  if (!leagues) {
    return <LoadingState rows={3} label="Loading your leagues" />;
  }

  if (leagues.length === 0) {
    return (
      <EmptyState
        title="No leagues yet"
        description="Create a league or join one with an invite code to get started."
        action={
          <Stack direction="row" gap={2}>
            <Link to="/leagues/new" className={styles.actionLink}>
              Create a league
            </Link>
            <Link to="/join" className={styles.actionLink}>
              Join a league
            </Link>
          </Stack>
        }
      />
    );
  }

  return (
    <Stack gap={4}>
      <Stack direction="row" justify="between" align="center">
        <Text as="h1" size="lg" weight="bold">
          Your leagues
        </Text>
        <Stack direction="row" gap={3}>
          <Link to="/leagues/new" className={styles.headerLink}>
            New
          </Link>
          <Link to="/join" className={styles.headerLink}>
            Join
          </Link>
        </Stack>
      </Stack>
      <Stack as="ul" gap={2} className={styles.list}>
        {leagues.map((league) => (
          <LeagueRow key={league.id} league={league} now={now} />
        ))}
      </Stack>
    </Stack>
  );
}
