import { LockIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./LockBadge.module.css";

export interface LockBadgeProps {
  className?: string;
}

/** A locked game — start passed, no final result yet. Icon + text,
 * same non-color-signal discipline as ResultBadge. */
export function LockBadge({ className }: LockBadgeProps) {
  return (
    <Stack direction="row" gap={1} align="center" className={cx(styles.badge, className)}>
      <LockIcon size={16} className={styles.icon} />
      <Text size="sm" weight="medium" color="locked">
        Locked
      </Text>
    </Stack>
  );
}
