import { useEffect, useRef, useState } from "react";
import { useUnsavedPickCount } from "../../offline/use-unsaved-pick-count.js";
import { useOnlineStatus } from "../../network/use-online-status.js";
import { useDataFreshness, useHealthPing } from "../../observability/use-data-freshness.js";
import { deriveGlobalBanner } from "./derive-global-banner.js";
import type { GlobalBanner } from "./GlobalBanner.types.js";

/** How long the "reconnecting" banner shows after coming back online —
 * long enough for the offline queue's own flush (offline/queue.ts) to
 * realistically finish a small queue, short enough not to linger once
 * the user is clearly just back to normal. */
const RECONNECTING_WINDOW_MS = 5_000;

/**
 * Composes every background signal into the single banner the shell
 * renders (`BannerStack.tsx`) — the ONE place these hooks are wired
 * together, per the brief's "one system" requirement.
 */
export function useGlobalBanners(): GlobalBanner | null {
  const online = useOnlineStatus();
  const unsavedPickCount = useUnsavedPickCount();
  const freshnessQuery = useDataFreshness();
  const healthPingQuery = useHealthPing();

  const [wasOfflineRecently, setWasOfflineRecently] = useState(false);
  const previousOnlineRef = useRef(online);

  useEffect(() => {
    const justCameBackOnline = !previousOnlineRef.current && online;
    previousOnlineRef.current = online;
    if (!justCameBackOnline) return;

    setWasOfflineRecently(true);
    const timer = setTimeout(() => setWasOfflineRecently(false), RECONNECTING_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [online]);

  return deriveGlobalBanner({
    online,
    wasOfflineRecently,
    healthPingFailed: healthPingQuery.isError,
    freshness: freshnessQuery.data,
    unsavedPickCount,
  });
}
