import { AlertIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./StaleBanner.module.css";

export interface StaleBannerProps {
  /** ISO timestamp of the data actually being shown — NOT "now."
   * Deliberately an absolute time ("as of 3:45 PM"), not a relative
   * one ("5 minutes ago"): a relative label goes silently wrong the
   * moment it stops re-rendering, which is exactly the failure mode
   * this component exists to avoid. */
  asOf: string;
  /** Why the data is stale, if known (e.g. "sports data provider is
   * degraded") — optional because the signal itself may not always
   * carry a reason. See docs/design-system.md for why there's
   * currently no live product-API field this maps to yet. */
  reason?: string;
  className?: string;
}

function formatAsOfTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an earlier time";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * DISTINCT from LoadingState — this is "known-old data, shown
 * anyway," not "still fetching." Never substitute one for the other:
 * showing a spinner when data is merely stale hides the fact that
 * what's on screen might already be wrong; showing this banner during
 * a genuine first load would falsely claim data exists at all.
 */
export function StaleBanner({ asOf, reason, className }: StaleBannerProps) {
  const formatted = formatAsOfTime(asOf);
  return (
    <Stack direction="row" gap={2} align="center" role="status" className={cx(styles.banner, className)}>
      <AlertIcon size={18} className={styles.icon} />
      <Text size="sm" weight="medium" color="stale">
        Showing data as of {formatted}
        {reason ? ` — ${reason}` : ""}
      </Text>
    </Stack>
  );
}
