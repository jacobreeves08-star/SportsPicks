import { useQuery } from "@tanstack/react-query";
import { getLeague } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/** A single league's own settings (timezone, sports, pick horizon,
 * commissioner) — distinct from `useMyLeagues()`'s per-league home-
 * screen summary shape, which doesn't carry these. Needed by the
 * slate screen (to know the pick horizon) and the league settings
 * screen (to load current values to edit). No polling — these change
 * rarely, refetch-on-focus/mount is enough, same as `useMyLeagues()`. */
export function useLeague(leagueId: string) {
  return useQuery({
    queryKey: queryKeys.league(leagueId),
    queryFn: () => getLeague(leagueId),
    enabled: leagueId.length > 0,
  });
}
