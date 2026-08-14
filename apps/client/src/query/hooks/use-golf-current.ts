import { useQuery } from "@tanstack/react-query";
import { getCurrentGolf } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/** The league's current golf tournament + live leaderboard. Polled on a
 * flat, slow interval rather than the slate's context-aware policy: a
 * golf leaderboard moves continuously over four days with no single
 * "lock instant" to accelerate toward (the one lock — the tournament
 * start — is a single event days before anything else happens), and
 * the underlying golf-ingest job only refreshes positions periodically
 * anyway, so a faster poll would return identical data. */
const GOLF_POLL_INTERVAL_MS = 120_000;

export function useGolfCurrent(leagueId: string) {
  return useQuery({
    queryKey: queryKeys.golfCurrent(leagueId),
    queryFn: () => getCurrentGolf(leagueId),
    enabled: leagueId.length > 0,
    refetchIntervalInBackground: false,
    refetchInterval: GOLF_POLL_INTERVAL_MS,
  });
}
