import type { ReactNode } from "react";
import { useIsAuthenticated } from "../api/use-auth-state.js";
import { AppShell } from "./AppShell.js";
import styles from "./MaybeShell.module.css";

/**
 * Renders `children` inside the app shell when there's a session, and
 * bare when there isn't.
 *
 * Exists for the routes that are genuinely BOTH — `/` and
 * `/college-quiz`. Neither can live under `authenticatedLayoutRoute`
 * (its `beforeLoad` would bounce a logged-out visitor to `/login`,
 * which is exactly what the college quiz feature is meant to stop
 * happening), but a logged-IN visitor landing on either should still
 * get their nav, banners, and league switcher rather than being
 * dumped onto a chrome-less page with no way back.
 *
 * The alternative — duplicating each screen under both a public and a
 * protected route — would mean two routes to keep in step for one
 * screen, and a `/college-quiz` that silently changed identity
 * depending on auth. This keeps one URL, one screen, and puts the
 * difference exactly where it belongs: the chrome around it.
 */
export function MaybeShell({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated) return <AppShell>{children}</AppShell>;

  // The bare branch still needs a landmark of its own. Inside the
  // shell, `AppShell` supplies the `<main>`; without it, the page's
  // entire content would sit outside any landmark, which axe fails
  // ("all page content should be contained by landmarks") and which
  // genuinely does leave a screen-reader user with nothing to jump to.
  // Caught by CollegeQuizScreen.test.tsx's axe scan, not by review.
  return <main className={styles.bareMain}>{children}</main>;
}
