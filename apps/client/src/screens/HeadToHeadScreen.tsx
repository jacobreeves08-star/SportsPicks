import { Link, useParams } from "@tanstack/react-router";
import { EmptyState, ErrorState, LoadingState, ResultBadge, Stack, Text } from "../design-system/index.js";
import { addDays } from "./leagues/slate-date.js";
import { useHeadToHead } from "../query/hooks/use-head-to-head.js";
import styles from "./HeadToHeadScreen.module.css";

/**
 * Games x members grid for one locked/finished slate (Epic 11 brief).
 * Only ever shows games the backend already filtered to `now() >=
 * starts_at` (head-to-head.routes.ts) — this screen never adds its
 * own visibility logic on top.
 *
 * The whole point of this screen, per the brief: with straight-up
 * picks and no spread, a league agrees most of the time, so the
 * handful of games where they didn't — `split` — or where the whole
 * league whiffed together — `allWrong` — is the actual social payload.
 * Both are computed server-side (never re-derived here, same
 * discipline as `pickState`/`outcome` elsewhere) and get a highlighted
 * row plus an explicit badge, never just a subtle color change.
 */
export function HeadToHeadScreen() {
  const { leagueId, date } = useParams({ from: "/_authenticated/leagues/$leagueId/head-to-head/$date" });
  const { data, isLoading, isError, refetch } = useHeadToHead(leagueId, date);

  if (isLoading) {
    return <LoadingState rows={4} label="Loading head-to-head" />;
  }

  if (isError) {
    return <ErrorState message="Couldn't load head-to-head." onRetry={() => void refetch()} />;
  }

  if (!data) {
    return <LoadingState rows={4} label="Loading head-to-head" />;
  }

  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const members = data.games[0]?.picks.map((pick) => ({ id: pick.leagueMemberId, name: pick.displayName })) ?? [];

  return (
    <Stack gap={4} className={styles.screen}>
      <Stack direction="row" justify="between" align="center">
        <Link
          to="/leagues/$leagueId/head-to-head/$date"
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
          to="/leagues/$leagueId/head-to-head/$date"
          params={{ leagueId, date: nextDate }}
          className={styles.dateLink}
          aria-label="Next day"
        >
          →
        </Link>
      </Stack>

      {data.games.length === 0 ? (
        <EmptyState title="Nothing locked yet" description="Head-to-head shows up once games on this day lock." />
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Game</th>
                {members.map((member) => (
                  <th scope="col" key={member.id}>
                    {member.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.games.map((game) => (
                <tr key={game.gameId} className={game.allWrong ? styles.allWrongRow : game.split ? styles.splitRow : undefined}>
                  <th scope="row" className={styles.gameCell}>
                    <Stack gap={1}>
                      <Text size="sm" weight="medium">
                        {game.homeTeam} vs {game.awayTeam}
                      </Text>
                      {game.winningTeam ? (
                        <Text size="xs" color="dim">
                          {game.winningTeam} won
                        </Text>
                      ) : null}
                      <Stack direction="row" gap={2}>
                        {game.split ? (
                          <Text size="xs" weight="bold" color="pick-mine" className={styles.splitBadge}>
                            SPLIT
                          </Text>
                        ) : null}
                        {game.allWrong ? (
                          <Text size="xs" weight="bold" color="error" className={styles.allWrongBadge}>
                            EVERYONE MISSED
                          </Text>
                        ) : null}
                      </Stack>
                    </Stack>
                  </th>
                  {members.map((member) => {
                    const pick = game.picks.find((p) => p.leagueMemberId === member.id);
                    return (
                      <td key={member.id} className={styles.pickCell}>
                        <Stack gap={1}>
                          <Text size="sm">{pick?.selectedTeam ?? "—"}</Text>
                          {pick && pick.hit !== null ? <ResultBadge outcome={pick.hit ? "hit" : "miss"} /> : null}
                        </Stack>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Stack>
  );
}
