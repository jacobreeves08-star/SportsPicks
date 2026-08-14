import { Link, useParams, useSearch } from "@tanstack/react-router";
import type { StandingsTimeframe } from "../api/types.js";
import { EmptyState, ErrorState, LoadingState, NumericText, Stack, Surface, Text } from "../design-system/index.js";
import { useStandings } from "../query/hooks/use-standings.js";
import styles from "./StandingsScreen.module.css";

const TIMEFRAMES: Array<{ value: StandingsTimeframe; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "season", label: "Season" },
];

function RankChange({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return (
      <Text size="xs" color="dim">
        —
      </Text>
    );
  }
  const up = value > 0;
  return (
    <NumericText size="xs" weight="medium" color={up ? "hit" : "miss"}>
      {up ? "▲" : "▼"} {Math.abs(value)}
    </NumericText>
  );
}

/**
 * Ranked standings (Epic 11 brief). The current user's row gets both
 * a visual treatment (raised surface, bold) AND `position: sticky`
 * (StandingsScreen.module.css) so it stays on screen as the list
 * scrolls past it — "anchored" and "pinned" are two distinct asks in
 * the brief, met by the same row.
 *
 * "Tap a member to see their picks for any LOCKED slate" routes to
 * Head-to-Head (Step 6) rather than duplicating a single-member pick
 * view here — that screen already shows every member's picks for a
 * locked slate side by side, which is a strict superset of "one
 * member's picks." Uses `data.date`, the standings response's own
 * anchor date (always today in the league's timezone, regardless of
 * which timeframe tab is selected — see standings.routes.ts).
 */
export function StandingsScreen() {
  const { leagueId } = useParams({ from: "/_authenticated/leagues/$leagueId/standings" });
  const { range } = useSearch({ from: "/_authenticated/leagues/$leagueId/standings" });
  const { data, isLoading, isError, refetch } = useStandings(leagueId, range);

  if (isLoading) {
    return <LoadingState rows={5} label="Loading standings" />;
  }

  if (isError) {
    return <ErrorState message="Couldn't load standings." onRetry={() => void refetch()} />;
  }

  if (!data) {
    return <LoadingState rows={5} label="Loading standings" />;
  }

  return (
    <Stack gap={4} className={styles.screen}>
      <Stack direction="row" role="tablist" aria-label="Standings timeframe" className={styles.tabBar}>
        {TIMEFRAMES.map((timeframe) => (
          <Link
            key={timeframe.value}
            to="/leagues/$leagueId/standings"
            params={{ leagueId }}
            search={{ range: timeframe.value }}
            role="tab"
            aria-selected={range === timeframe.value}
            className={range === timeframe.value ? styles.tabActive : styles.tab}
          >
            {timeframe.label}
          </Link>
        ))}
      </Stack>

      {data.standings.length === 0 ? (
        <EmptyState title="No standings yet" description="Standings show up once picks are made." />
      ) : (
        <Stack as="ul" gap={2} className={styles.list}>
          {data.standings.map((entry) => {
            const isMe = entry.leagueMemberId === data.callerLeagueMemberId;
            return (
              <li key={entry.leagueMemberId} className={isMe ? styles.meRow : undefined}>
                <Link
                  to="/leagues/$leagueId/head-to-head/$date"
                  params={{ leagueId, date: data.date }}
                  className={styles.row}
                >
                  <Surface variant="raised" radius="md" padding={3} className={styles.rowSurface}>
                    <Stack direction="row" justify="between" align="center" gap={3}>
                      <Stack direction="row" gap={2} align="center">
                        <NumericText weight="bold" size="sm" className={styles.rankBadge}>
                          {entry.rank}
                        </NumericText>
                        <Text weight={isMe ? "bold" : "regular"}>
                          {entry.displayName}
                          {isMe ? " (you)" : ""}
                        </Text>
                      </Stack>
                      <Stack direction="row" gap={3} align="center">
                        <NumericText size="sm" color="dim">
                          {entry.wins}-{entry.losses}
                        </NumericText>
                        <NumericText size="sm" color="dim">
                          {(entry.winPct * 100).toFixed(0)}%
                        </NumericText>
                        <NumericText size="sm" color="dim">
                          {entry.gamesParticipated} GP
                        </NumericText>
                        <RankChange value={entry.rankChange} />
                      </Stack>
                    </Stack>
                  </Surface>
                </Link>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
