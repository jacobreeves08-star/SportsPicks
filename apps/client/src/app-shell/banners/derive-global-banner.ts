import type { OpsSummary } from "../../api/types.js";
import type { GlobalBanner } from "./GlobalBanner.types.js";

export interface DeriveGlobalBannerInput {
  online: boolean;
  /** True for a short window right after `online` flips from false to
   * true — see `use-global-banners.ts`. */
  wasOfflineRecently: boolean;
  healthPingFailed: boolean;
  freshness: OpsSummary | undefined;
  unsavedPickCount: number;
}

/**
 * Pure, standalone-tested BEFORE anything renders it — mirrors
 * `query/polling.ts`'s pure-function-fed-by-a-hook split. Fixed
 * priority, most urgent first:
 *
 *   offline > degraded > reconnecting > unsaved-picks > stale
 *
 * No connection or an unhealthy server dominate everything else —
 * nothing else the user does matters until one of those resolves.
 * "Still flushing after reconnecting" beats "some picks queued, idle"
 * because it's actively in flight. Stale data is informational, the
 * lowest urgency of the five.
 */
export function deriveGlobalBanner(input: DeriveGlobalBannerInput): GlobalBanner | null {
  if (!input.online) {
    return { kind: "offline" };
  }

  const anyTrackedJobFailed = input.freshness?.jobs.some((job) => job.lastRunSucceeded === false) ?? false;
  if (input.healthPingFailed || anyTrackedJobFailed) {
    return { kind: "degraded" };
  }

  if (input.wasOfflineRecently) {
    return { kind: "reconnecting" };
  }

  if (input.unsavedPickCount > 0) {
    return { kind: "unsaved-picks", count: input.unsavedPickCount };
  }

  if (input.freshness && input.freshness.staleGameCount > 0) {
    return { kind: "stale", asOf: input.freshness.generatedAt };
  }

  return null;
}
