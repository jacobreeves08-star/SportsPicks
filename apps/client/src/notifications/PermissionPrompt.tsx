import { useState } from "react";
import { Stack, Text, cx } from "../design-system/index.js";
import styles from "./PermissionPrompt.module.css";
import { useFirstCompletionPrompt } from "./use-first-completion-prompt.js";
import { useNotificationPermission } from "./use-notification-permission.js";

/**
 * The post-first-slate-completion permission ask (Epic 10 brief:
 * never cold — asking before the user has any reason to trust the
 * app gets denied, and a denied browser permission is very hard to
 * recover). Shown at most once, ever, per `useFirstCompletionPrompt()`'s
 * own contract.
 *
 * Deliberately labeled as a SEPARATE "also get a browser notification"
 * opt-in, not a rewording of the real email preference
 * (`PreferencesForm`'s global toggle) — this repo has no push
 * delivery mechanism at all yet (docs/notifications.md: email only),
 * so requesting browser permission today captures consent for a
 * channel nothing sends to. Being honest about that in the copy
 * itself is the point, not an implementation detail to hide.
 */
export function PermissionPrompt() {
  const shouldPrompt = useFirstCompletionPrompt();
  const { state, request } = useNotificationPermission();
  const [dismissed, setDismissed] = useState(false);

  if (!shouldPrompt || state !== "default" || dismissed) return null;

  return (
    <Stack gap={2} role="status" className={styles.card}>
      <Text weight="medium">Get a browser notification too?</Text>
      <Text size="sm" color="dim">
        You&rsquo;ll still get email reminders either way — this just adds a nudge on this device before games lock.
      </Text>
      <Stack direction="row" gap={2}>
        <button type="button" className={cx(styles.button, styles.buttonPrimary)} onClick={() => void request()}>
          Enable
        </button>
        <button type="button" className={styles.button} onClick={() => setDismissed(true)}>
          Not now
        </button>
      </Stack>
    </Stack>
  );
}
