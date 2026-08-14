import { Link } from "@tanstack/react-router";
import { CalendarIcon, ChartIcon, HomeIcon, Stack, Text, UserIcon } from "../design-system/index.js";
import { useCurrentLeagueId } from "../leagues/use-current-league.js";
import styles from "./BottomNav.module.css";

/**
 * Mobile-first, reachable one-handed (Epic 10 brief) — fixed to the
 * bottom, four destinations: home (all leagues), the current league's
 * slate, its standings, and profile. `position: fixed` here is
 * deliberate and the ONE exception to "reserved layout space, not
 * fixed overlay" (see BannerStack.tsx's comment) — a bottom nav is
 * expected to float over content at the very bottom of the screen;
 * what it must never do is cover the PICK CONTROL or a COUNTDOWN
 * higher up the page, which is a screen-level responsibility (Epic
 * 11's slate screen reserves its own bottom padding to clear this
 * nav, the same way a fixed bottom nav always requires of its content).
 *
 * Slate/standings links need a "current league" (leagues/use-current-league.ts)
 * — when the caller has no leagues yet (or the list hasn't loaded),
 * those two destinations render disabled rather than linking
 * somewhere wrong.
 */
export function BottomNav() {
  const currentLeagueId = useCurrentLeagueId();

  return (
    <nav aria-label="Primary" className={styles.nav}>
      <Stack direction="row" className={styles.row}>
        <Link to="/" className={styles.item} activeProps={{ className: styles.itemActive, "aria-current": "page" }}>
          <HomeIcon size={22} className={styles.icon} />
          <Text size="xs" weight="medium">
            Home
          </Text>
        </Link>

        {currentLeagueId ? (
          <Link
            to="/leagues/$leagueId/slate"
            params={{ leagueId: currentLeagueId }}
            className={styles.item}
            activeProps={{ className: styles.itemActive, "aria-current": "page" }}
          >
            <CalendarIcon size={22} className={styles.icon} />
            <Text size="xs" weight="medium">
              Slate
            </Text>
          </Link>
        ) : (
          <span className={styles.itemDisabled} aria-disabled="true">
            <CalendarIcon size={22} className={styles.icon} />
            <Text size="xs" color="dim">
              Slate
            </Text>
          </span>
        )}

        {currentLeagueId ? (
          <Link
            to="/leagues/$leagueId/standings"
            params={{ leagueId: currentLeagueId }}
            search={{ range: "today" }}
            className={styles.item}
            activeProps={{ className: styles.itemActive, "aria-current": "page" }}
          >
            <ChartIcon size={22} className={styles.icon} />
            <Text size="xs" weight="medium">
              Standings
            </Text>
          </Link>
        ) : (
          <span className={styles.itemDisabled} aria-disabled="true">
            <ChartIcon size={22} className={styles.icon} />
            <Text size="xs" color="dim">
              Standings
            </Text>
          </span>
        )}

        <Link to="/profile" className={styles.item} activeProps={{ className: styles.itemActive, "aria-current": "page" }}>
          <UserIcon size={22} className={styles.icon} />
          <Text size="xs" weight="medium">
            Profile
          </Text>
        </Link>
      </Stack>
    </nav>
  );
}
