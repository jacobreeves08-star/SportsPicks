import { useRouter, useRouterState } from "@tanstack/react-router";
import { setCurrentLeagueId } from "../leagues/current-league-store.js";
import { useCurrentLeagueId } from "../leagues/use-current-league.js";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import styles from "./LeagueSwitcher.module.css";

/**
 * Fast switching, no full reload (Epic 10 brief) — a native `<select>`
 * (accessible, zero custom-dropdown a11y work needed) that carries the
 * current DATE or RANGE across the switch when the current screen
 * has one: slate on Nov 12 in league A -> slate on Nov 12 in league B,
 * not back to "today." Reads the current route match to decide which
 * case applies; falls back to the league's slate index (resolves its
 * own date) everywhere else — home, profile, or mid-navigation.
 */
export function LeagueSwitcher() {
  const { data: leagues } = useMyLeagues();
  const currentLeagueId = useCurrentLeagueId();
  const router = useRouter();
  const matches = useRouterState({ select: (state) => state.matches });

  if (!leagues || leagues.length === 0) return null;

  function handleChange(newLeagueId: string) {
    setCurrentLeagueId(newLeagueId);

    const slateMatch = matches.find((match) => match.routeId === "/_authenticated/leagues/$leagueId/slate/$date");
    if (slateMatch) {
      const { date } = slateMatch.params as { date: string };
      void router.navigate({ to: "/leagues/$leagueId/slate/$date", params: { leagueId: newLeagueId, date } });
      return;
    }

    const standingsMatch = matches.find((match) => match.routeId === "/_authenticated/leagues/$leagueId/standings");
    if (standingsMatch) {
      const { range } = standingsMatch.search as { range: "today" | "week" | "season" };
      void router.navigate({ to: "/leagues/$leagueId/standings", params: { leagueId: newLeagueId }, search: { range } });
      return;
    }

    void router.navigate({ to: "/leagues/$leagueId/slate", params: { leagueId: newLeagueId } });
  }

  return (
    <select
      aria-label="Switch league"
      className={styles.select}
      value={currentLeagueId ?? ""}
      onChange={(event) => handleChange(event.target.value)}
    >
      {leagues.map((league) => (
        <option key={league.id} value={league.id}>
          {league.name}
        </option>
      ))}
    </select>
  );
}
