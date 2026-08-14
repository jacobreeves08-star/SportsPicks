import { AlertIcon, CloudOffIcon, StaleBanner } from "../../design-system/index.js";
import { StatusBanner } from "./StatusBanner.js";
import { useGlobalBanners } from "./use-global-banners.js";

/**
 * The single mount point for the global banner system (Epic 10
 * brief). Renders AT MOST ONE banner — `useGlobalBanners()`/
 * `derive-global-banner.ts` already picked the one that matters.
 *
 * Mounted in `AppShell.tsx` as a real row ABOVE the routed `<Outlet/>`
 * in normal document flow — never `position: fixed` — so a banner
 * reserves its own layout space and pushes content down instead of
 * risking covering anything beneath it (the pick control, a
 * countdown). That's a structural guarantee, not a z-index
 * convention a later screen could violate.
 */
export function BannerStack() {
  const banner = useGlobalBanners();
  if (!banner) return null;

  switch (banner.kind) {
    case "offline":
      return <StatusBanner icon={<CloudOffIcon />} message="You're offline. Picks will send once you're back." tone="warning" role="status" />;
    case "degraded":
      return <StatusBanner icon={<AlertIcon />} message="Having trouble reaching the server." tone="warning" role="status" />;
    case "reconnecting":
      return <StatusBanner icon={<CloudOffIcon />} message="Back online — sending your queued picks…" tone="info" role="status" />;
    case "unsaved-picks":
      return (
        <StatusBanner
          icon={<CloudOffIcon />}
          message={banner.count === 1 ? "1 pick hasn't saved yet." : `${banner.count} picks haven't saved yet.`}
          tone="info"
          role="status"
        />
      );
    case "stale":
      return <StaleBanner asOf={banner.asOf} reason={banner.reason} />;
  }
}
