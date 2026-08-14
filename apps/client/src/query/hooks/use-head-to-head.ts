import { useQuery } from "@tanstack/react-query";
import { getHeadToHead } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/**
 * Games x members grid for one day (Epic 11 brief). Same flat polling
 * cadence as use-standings.ts — results can still be landing on the
 * day being viewed (this screen is reached FROM standings' "today"
 * anchor date most of the time), so a fixed interval rather than no
 * polling at all; no lock-aware speedup needed since every game here
 * is already locked by the backend's own visibility rule.
 */
export function useHeadToHead(leagueId: string, date: string) {
  return useQuery({
    queryKey: queryKeys.headToHead(leagueId, date),
    queryFn: () => getHeadToHead(leagueId, date),
    enabled: leagueId.length > 0 && date.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
