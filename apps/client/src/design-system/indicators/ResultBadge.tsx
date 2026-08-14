import { CheckIcon, XIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./ResultBadge.module.css";

export interface ResultBadgeProps {
  outcome: "hit" | "miss";
  className?: string;
}

/**
 * Epic 9 brief: every hit/miss indicator pairs color with an
 * INDEPENDENT non-color signal — here, both a distinct icon shape
 * (check vs. x) and distinct text ("Correct" vs. "Incorrect"), so
 * removing color entirely (a colorblind user, a greyscale render)
 * still leaves the result unambiguous. Never render only the colored
 * icon or only a colored background.
 */
const CONTENT = {
  hit: { Icon: CheckIcon, label: "Correct", textColor: "hit", iconClass: styles["icon-hit"] },
  miss: { Icon: XIcon, label: "Incorrect", textColor: "miss", iconClass: styles["icon-miss"] },
} as const;

export function ResultBadge({ outcome, className }: ResultBadgeProps) {
  const { Icon, label, textColor, iconClass } = CONTENT[outcome];
  return (
    <Stack direction="row" gap={1} align="center" className={cx(styles.badge, styles[`badge-${outcome}`], className)}>
      <Icon size={16} className={iconClass} />
      <Text size="sm" weight="bold" color={textColor}>
        {label}
      </Text>
    </Stack>
  );
}
