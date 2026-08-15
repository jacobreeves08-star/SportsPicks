import { Link, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { EmptyState, ErrorState, LoadingState, PickControl, Stack, Surface, Text } from "../design-system/index.js";
import { deriveGameState } from "../game-state/game-state.js";
import { sportLabel } from "../leagues/sports.js";
import { notifyPossibleSlateCompletion } from "../notifications/notification-prompt-bus.js";
import { useLeague } from "../query/hooks/use-league.js";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import { useSlate } from "../query/hooks/use-slate.js";
import { useCorrectedNow } from "../time/use-clock.js";
import { groupSlateGamesBySport } from "./leagues/group-slate-games.js";
import { addDays } from "./leagues/slate-date.js";
import { useSlatePicks } from "./leagues/use-slate-picks.js";
import styles from "./SlateScreen.module.css";

/**
 * The core loop (Epic 11 brief — "a ten-game slate completed on a
 * phone in under a minute"). Deliberately does NOT render other
 * members' picks or hasPicked counts here, even though `SlateGame`
 * carries `otherPicks` — Head-to-Head (Step 6) is the dedicated screen
 * for that, and the backend already hides it until each game locks
 * (docs/picks-and-locking.md); cluttering this screen with it would
 * work against the speed target this screen exists for.
 */
export function SlateScreen() {
  const { leagueId, date } = useParams({ from: "/_authenticated/leagues/$leagueId/slate/$date" });

  const { data: leagues, isLoading: leaguesLoading, isError: leaguesError, refetch: refetchLeagues } = useMyLeagues();
  const memberId = leagues?.find((league) => league.id === leagueId)?.leagueMemberId;

  const { data: league, isLoading: leagueLoading, isError: leagueError, refetch: refetchLeague } = useLeague(leagueId);

  const { data: slate, isLoading: slateLoading, isError: slateError, refetch: refetchSlate } = useSlate(leagueId, date);
  const now = useCorrectedNow(1000);
  const { getState, selectPick } = useSlatePicks(leagueId, memberId ?? "", date, league?.pickHorizonDays ?? 7, now);

  useEffect(() => {
    if (slate) notifyPossibleSlateCompletion(slate);
  }, [slate]);

  if (slateLoading || leaguesLoading || leagueLoading) {
    return <LoadingState rows={4} label="Loading today's games" />;
  }

  if (slateError) {
    return <ErrorState message="Couldn't load this slate." onRetry={() => void refetchSlate()} />;
  }

  if (leaguesError || !memberId) {
    return <ErrorState message="Couldn't load this league." onRetry={() => void refetchLeagues()} />;
  }

  if (leagueError || !league) {
    return <ErrorState message="Couldn't load this league." onRetry={() => void refetchLeague()} />;
  }

  if (!slate) {
    return <LoadingState rows={4} label="Loading today's games" />;
  }

  const groups = groupSlateGamesBySport(slate.games);
  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const progressPct = slate.totalCount > 0 ? Math.round((slate.pickedCount / slate.totalCount) * 100) : 0;

  return (
    <Stack gap={4} className={styles.screen}>
      <Surface variant="raised" radius="lg" padding={2} className={styles.dateBar}>
        <Stack direction="row" justify="between" align="center">
          <Link
            to="/leagues/$leagueId/slate/$date"
            params={{ leagueId, date: previousDate }}
            className={styles.dateLink}
            aria-label="Previous day"
          >
            ←
          </Link>
          <Text as="h1" size="lg" weight="bold">
            {date}
          </Text>
          <Link
            to="/leagues/$leagueId/slate/$date"
            params={{ leagueId, date: nextDate }}
            className={styles.dateLink}
            aria-label="Next day"
          >
            →
          </Link>
        </Stack>
      </Surface>

      <Stack gap={2}>
        <Stack direction="row" justify="between" align="center">
          <Text size="sm" weight="medium" color="dim">
            {slate.pickedCount} of {slate.totalCount} picked
          </Text>
          {progressPct === 100 && slate.totalCount > 0 ? (
            <Text size="sm" weight="bold" color="hit">
              All set
            </Text>
          ) : null}
        </Stack>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label="Picks made"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
      </Stack>

      {/* Golf never appears on the slate itself — a tournament isn't a
          game and has no per-day rows — so this is how a golf league
          reaches it. Only rendered when the league actually covers golf,
          rather than adding a 5th bottom-nav item that would be dead for
          every other league. */}
      {league.sports.includes("golf") ? (
        <Link to="/leagues/$leagueId/golf" params={{ leagueId }} className={styles.golfLink}>
          <Surface variant="raised" radius="md" padding={3}>
            <Stack direction="row" justify="between" align="center">
              <Text weight="medium">Golf tournament</Text>
              <Text size="sm" color="dim">
                View →
              </Text>
            </Stack>
          </Surface>
        </Link>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState title="No games" description="Nothing on the slate for this day." />
      ) : (
        groups.map((group) => (
          <Stack key={group.sport} as="section" gap={2}>
            <Text size="xs" weight="bold" color="dim" className={styles.sportHeading}>
              {sportLabel(group.sport)}
            </Text>
            <Stack gap={3}>
              {group.games.map((game) => {
                const gameState = deriveGameState(game, now);
                const remainingMs = gameState.kind === "SCHEDULED" ? gameState.startsAt.getTime() - now : undefined;
                return (
                  <Surface key={game.gameId} variant="raised" radius="md" padding={3}>
                    <PickControl
                      teams={{
                        homeTeam: game.homeTeam,
                        awayTeam: game.awayTeam,
                        homeTeamLogoUrl: game.homeTeamLogoUrl,
                        awayTeamLogoUrl: game.awayTeamLogoUrl,
                        homeTeamFlagUrl: game.homeTeamFlagUrl,
                        awayTeamFlagUrl: game.awayTeamFlagUrl,
                        homeTeamColor: game.homeTeamColor,
                        awayTeamColor: game.awayTeamColor,
                        allowsDraw: game.allowsDraw,
                        startsAt: game.startsAt,
                      }}
                      state={getState(game, gameState)}
                      onSelect={(team) => selectPick(game, team)}
                      remainingMs={remainingMs}
                    />
                  </Surface>
                );
              })}
            </Stack>
          </Stack>
        ))
      )}
    </Stack>
  );
}
