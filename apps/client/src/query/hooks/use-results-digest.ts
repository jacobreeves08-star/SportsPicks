import { useQuery } from "@tanstack/react-query";
import { getResultsDigest } from "../../api/endpoints.js";
import { queryKeys } from "../keys.js";

/** Fetched on demand by `ResultsDigestModal` — `enabled` defaults to
 * `true` for any other caller, but the modal passes `false` when
 * `results-digest-tracker.ts` already recorded today as shown, so a
 * reload later the same day costs nothing (no fetch at all), not just
 * a fetch whose result gets thrown away. */
export function useResultsDigest(enabled = true) {
  return useQuery({
    queryKey: queryKeys.resultsDigest(),
    queryFn: () => getResultsDigest(),
    enabled,
  });
}
