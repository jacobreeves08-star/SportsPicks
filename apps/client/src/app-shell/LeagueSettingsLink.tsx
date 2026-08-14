import { Link } from "@tanstack/react-router";
import { useCurrentLeagueId } from "../leagues/use-current-league.js";
import { useLeague } from "../query/hooks/use-league.js";
import { useMe } from "../query/hooks/use-me.js";
import styles from "./LeagueSettingsLink.module.css";

/**
 * The header's "⚙" link to `/leagues/:leagueId/settings` — shown only
 * when a current league is selected AND the caller is its commissioner
 * (`LeagueSettingsScreen` re-enforces this itself; hiding the link here
 * is a UX nicety, not the access check). Renders nothing otherwise,
 * same "null when not applicable" posture as `LeagueSwitcher`.
 */
export function LeagueSettingsLink() {
  const currentLeagueId = useCurrentLeagueId();
  const { data: me } = useMe();
  const { data: league } = useLeague(currentLeagueId ?? "");

  if (!currentLeagueId || !me || !league || league.commissionerId !== me.id) return null;

  return (
    <Link
      to="/leagues/$leagueId/settings"
      params={{ leagueId: currentLeagueId }}
      aria-label="League settings"
      className={styles.link}
    >
      ⚙
    </Link>
  );
}
