import { useEffect, useState } from "react";
import { Stack, Surface, Text, XIcon } from "../design-system/index.js";
import { getLastShownDate, markShownToday, todayLocalDate } from "../notifications/results-digest-tracker.js";
import { useResultsDigest } from "../query/hooks/use-results-digest.js";
import { ShareResultsButton } from "./ShareResultsButton.js";
import styles from "./ResultsDigestModal.module.css";

/**
 * "How did I do yesterday?" — a dismissible pop-up shown once per
 * device-local calendar day (confirmed with the user directly), mounted
 * from `AppShell` next to `<BannerStack />` so it shows regardless of
 * which screen a reopen/login lands on — a deep link straight to
 * `/leagues/:id/standings` would otherwise miss a `HomeScreen`-only
 * hook. This is why the trigger is an app-shell-mount check comparing
 * a stored "last shown date" against today, not a pub/sub event like
 * `notification-prompt-bus.ts`'s completion prompt — that bus fires on
 * a slate-completion EVENT, but this has no analogous event to hook;
 * it just needs to know once, on mount, whether today already happened.
 */
export function ResultsDigestModal() {
  const [shouldFetch] = useState(() => getLastShownDate() !== todayLocalDate());
  const { data, isSuccess } = useResultsDigest(shouldFetch);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isSuccess || !data) return;
    // Marked BEFORE the state update that would show the dialog — same
    // race-avoidance discipline as first-completion-tracker.ts's
    // markSlateCompleted(): a reload that happens between this line and
    // the user seeing the dialog can never cause it to show twice today.
    markShownToday(todayLocalDate());
    if (data.leagues.length > 0) setVisible(true);
  }, [isSuccess, data]);

  if (!visible || !data) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={() => setVisible(false)}>
      <Surface
        as="section"
        variant="raised"
        radius="lg"
        padding={4}
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-digest-title"
        className={styles.dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <Stack gap={3}>
          <div className={styles.header}>
            <Text as="h2" id="results-digest-title" size="lg" weight="bold">
              Yesterday&rsquo;s results
            </Text>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Dismiss"
              onClick={() => setVisible(false)}
            >
              <XIcon size={18} />
            </button>
          </div>

          <div>
            {data.leagues.map((entry) => (
              <Stack key={entry.leagueId} direction="row" justify="between" align="center" className={styles.leagueRow}>
                <Text size="sm">{entry.leagueName}</Text>
                <Text size="sm" weight="bold" tabular>
                  {entry.wins}-{entry.losses}
                </Text>
              </Stack>
            ))}
          </div>

          <ShareResultsButton entries={data.leagues} />
        </Stack>
      </Surface>
    </div>
  );
}
