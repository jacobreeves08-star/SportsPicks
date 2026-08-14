import { Link, Outlet } from "@tanstack/react-router";
import { BannerStack } from "./banners/BannerStack.js";
import styles from "./AppShell.module.css";
import { BottomNav } from "./BottomNav.js";
import { LeagueSettingsLink } from "./LeagueSettingsLink.js";
import { LeagueSwitcher } from "./LeagueSwitcher.js";
import { ResultsDigestModal } from "./ResultsDigestModal.js";

/**
 * `authenticatedLayoutRoute`'s `component` (routes/route-tree.tsx) —
 * the ONE mount point for nav chrome and banners, wrapping every
 * protected route. `[header][BannerStack][Outlet][BottomNav]` in real
 * document flow, top to bottom — a banner reserves its own space and
 * pushes the routed content down; it never overlays it. `BottomNav` is
 * the one deliberately `position: fixed` piece, and `.main`'s own
 * bottom padding is what keeps it from covering anything (see
 * AppShell.module.css) — the same structural guarantee `BannerStack`'s
 * own doc comment describes, applied to the opposite edge of the
 * screen.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          Pick&rsquo;em
        </Link>
        <LeagueSwitcher />
        <LeagueSettingsLink />
      </header>
      <BannerStack />
      <ResultsDigestModal />
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
