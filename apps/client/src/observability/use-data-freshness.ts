import { useQuery } from "@tanstack/react-query";
import { getDataFreshness, pingHealth } from "../api/endpoints.js";
import { queryKeys } from "../query/keys.js";

/** A coarse background check, NOT this app's fast slate-lock polling
 * (query/polling.ts) — minutes, not seconds. `GET /health/data-freshness`
 * is a public, unauthenticated, ops-built endpoint this epic repurposes
 * as the product's own stale-data signal (docs/app-shell.md — there is
 * no per-slate equivalent on the product API). */
const FRESHNESS_POLL_MS = 5 * 60_000;

/** Feeds the global banner system's "stale" tone
 * (app-shell/banners/derive-global-banner.ts) — `staleGameCount > 0`
 * means some game somewhere is overdue a result. `retry: false`
 * because a failed freshness poll IS itself the "degraded" signal;
 * retrying would only delay surfacing that. */
export function useDataFreshness() {
  return useQuery({
    queryKey: queryKeys.dataFreshness(),
    queryFn: getDataFreshness,
    refetchInterval: FRESHNESS_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Basic API reachability — feeds "degraded" independently of
 * `useDataFreshness` (the freshness endpoint could itself be the
 * thing failing, distinct from "the API is up but some data is
 * stale"). */
export function useHealthPing() {
  return useQuery({
    queryKey: queryKeys.healthPing(),
    queryFn: pingHealth,
    refetchInterval: FRESHNESS_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
