import { useState } from "react";
import { Stack, Text } from "../design-system/index.js";
import { useMe } from "../query/hooks/use-me.js";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import styles from "./PreferencesForm.module.css";
import { useUpdateGlobalNotifications, useUpdateLeagueNotifications } from "./use-notification-preferences.js";

/**
 * Global toggle + per-league toggles, wired to the real backend
 * (Epic 10 — `PATCH /users/me/notifications` and
 * `PATCH /leagues/:leagueId/members/:memberId/notifications`, both
 * added this epic). The global switch reads/writes `useMe()`'s cache
 * for real. The per-league toggles are LOCAL state only, defaulting
 * to "on" (the schema default) each time this form loads — there is
 * DELIBERATELY no read endpoint for the per-league value yet (adding
 * one on the members LIST route would leak one member's preference to
 * every other member; a correctly-scoped "my own membership" read is
 * real follow-up work, not built under time pressure — see
 * docs/app-shell.md). Writes are still real; only the initial
 * displayed state is a known, flagged gap.
 */
export function PreferencesForm() {
  const { data: me } = useMe();
  const { data: leagues } = useMyLeagues();
  const updateGlobal = useUpdateGlobalNotifications();
  const updateLeague = useUpdateLeagueNotifications();

  const [leagueOverrides, setLeagueOverrides] = useState<Record<string, boolean>>({});

  if (!me) return null;

  function handleLeagueToggle(leagueId: string, memberId: string, enabled: boolean) {
    const previous = leagueOverrides[leagueId] ?? true;
    setLeagueOverrides((current) => ({ ...current, [leagueId]: enabled }));
    updateLeague.mutate(
      { leagueId, memberId, enabled },
      {
        onError: () => {
          setLeagueOverrides((current) => ({ ...current, [leagueId]: previous }));
        },
      },
    );
  }

  return (
    <Stack gap={4} className={styles.form}>
      <label className={styles.row}>
        <Stack gap={1}>
          <Text weight="medium">Email notifications</Text>
          <Text size="sm" color="dim">
            Pick reminders and results summaries.
          </Text>
        </Stack>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={me.notificationsEnabled}
          onChange={(event) => updateGlobal.mutate(event.target.checked)}
          aria-label="Email notifications"
        />
      </label>

      {leagues && leagues.length > 0 ? (
        <Stack gap={1}>
          <Text size="sm" weight="medium" color="dim">
            Per league
          </Text>
          {leagues.map((league) => (
            <label key={league.id} className={styles.row}>
              <Text>{league.name}</Text>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={leagueOverrides[league.id] ?? true}
                disabled={!me.notificationsEnabled}
                onChange={(event) => handleLeagueToggle(league.id, league.leagueMemberId, event.target.checked)}
                aria-label={`${league.name} notifications`}
              />
            </label>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
