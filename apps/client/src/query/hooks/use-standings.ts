import { useQuery } from "@tanstack/react-query";
import { getStandings } from "../../api/endpoints.js";
import type { StandingsTimeframe } from "../../api/types.js";
import { queryKeys } from "../keys.js";

/**
 * Standings for one timeframe. Polled on a plain fixed interval
 * (unlike the slate's lock-aware `computeSlatePollingIntervalMs`) —
 * standings have no "about to lock" urgency to speed up around, just
 * the brief's flat "live updates as results land on game days."
 * `refetchIntervalInBackground: false` matches every other poller in
 * this app (query-client.ts's stated convention): a backgrounded tab
 * stops polling and catches up on refocus.
 */
export function useStandings(leagueId: string, timeframe: StandingsTimeframe) {
  return useQuery({
    queryKey: queryKeys.standings(leagueId, timeframe),
    queryFn: () => getStandings(leagueId, { timeframe }),
    enabled: leagueId.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
