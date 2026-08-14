import { useEffect, useState } from "react";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import { getCurrentLeagueId, subscribeToCurrentLeague } from "./current-league-store.js";

/**
 * The league the shell should treat as "current" — the bottom nav's
 * slate/standings links and the league switcher's default both read
 * this. Re-validates the stored selection against the caller's ACTUAL
 * league list on every render: a league the user has since left or
 * been removed from must silently fall back to the first entry, never
 * point the nav at somewhere the user can no longer see.
 *
 * Returns `undefined` while `useMyLeagues()` hasn't resolved yet, or
 * if the caller is in zero leagues — a screen (Epic 11's home screen)
 * decides what "no current league" looks like; this hook doesn't
 * guess for it.
 */
export function useCurrentLeagueId(): string | undefined {
  const { data: leagues } = useMyLeagues();
  const [stored, setStored] = useState(getCurrentLeagueId);

  useEffect(() => subscribeToCurrentLeague(setStored), []);

  if (!leagues || leagues.length === 0) return undefined;

  const firstLeague = leagues[0];
  if (!firstLeague) return undefined;

  if (stored !== null && leagues.some((league) => league.id === stored)) {
    return stored;
  }
  return firstLeague.id;
}
