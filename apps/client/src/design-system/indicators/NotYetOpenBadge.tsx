import { CalendarIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./NotYetOpenBadge.module.css";

export interface NotYetOpenBadgeProps {
  /** ISO timestamp for when picking opens for this game (a container's
   * `startsAt` minus the league's `pickHorizonDays`) — formatted as an
   * absolute date, same "never a raw value the component re-derives"
   * discipline as `PickControlTeams.startsAt`. */
  opensAt: string;
  className?: string;
}

/** A game further out than the league's pick horizon — visible on the
 * slate (never hidden) but not yet pickable. Icon + text, same non-
 * color-signal discipline as `LockBadge`/`VoidBadge`; deliberately NOT
 * `--color-state-locked` (amber), since "not yet open" isn't a warning
 * — it's neutral, informational, same posture as `VoidBadge`. */
export function NotYetOpenBadge({ opensAt, className }: NotYetOpenBadgeProps) {
  return (
    <Stack direction="row" gap={1} align="center" className={cx(styles.badge, className)}>
      <CalendarIcon size={16} className={styles.icon} />
      <Text size="sm" weight="medium" color="dim">
        Opens {formatOpensDate(opensAt)}
      </Text>
    </Stack>
  );
}

function formatOpensDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
