import { useQuery } from "@tanstack/react-query";
import { getStandings } from "../../api/endpoints.js";
import type { StandingsTimeframe } from "../../api/types.js";
import { queryKeys } from "../keys.js";

export function useStandings(leagueId: string, timeframe?: StandingsTimeframe, date?: string) {
  return useQuery({
    queryKey: queryKeys.standings(leagueId, timeframe, date),
    queryFn: () => getStandings(leagueId, { timeframe, date }),
    enabled: leagueId.length > 0,
  });
}
