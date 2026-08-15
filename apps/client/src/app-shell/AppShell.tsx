import type { ReactNode } from "react";
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
 *
 * `children` exists for the two routes that are PUBLIC but still want
 * the shell when the visitor happens to be logged in — `/` and
 * `/college-quiz`, which can't hang off `authenticatedLayoutRoute`
 * because a logged-out visitor must reach them (see
 * routes/route-tree.tsx and `MaybeShell`). Every other route still
 * arrives through `<Outlet />` exactly as before; omitting `children`
 * is the layout-route behavior, unchanged.
 */
export function AppShell({ children }: { children?: ReactNode } = {}) {
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
      <main className={styles.main}>{children ?? <Outlet />}</main>
      <BottomNav />
    </div>
  );
}
