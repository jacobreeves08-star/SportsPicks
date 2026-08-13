import { CalendarOffIcon } from "../icons/index.js";
import { Stack } from "../primitives/Stack.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import styles from "./VoidBadge.module.css";

export interface VoidBadgeProps {
  /** Matches `GameState`'s `VOID.reason` (game-state/game-state.ts) —
   * postponed games can recover to SCHEDULED later, canceled games
   * are terminal. Distinct text for each, not a single generic
   * "Void," so a member can tell whether picking might reopen. */
  reason: "postponed" | "canceled";
  className?: string;
}

const LABEL: Record<VoidBadgeProps["reason"], string> = {
  postponed: "Postponed",
  canceled: "Canceled",
};

/** Cancelled or postponed — no win/loss/penalty either way (see
 * docs/scoring-and-standings.md: voided for everyone). Deliberately
 * NOT using result-hit/result-miss/state-locked colors — a void game
 * isn't a result at all. */
export function VoidBadge({ reason, className }: VoidBadgeProps) {
  return (
    <Stack direction="row" gap={1} align="center" className={cx(styles.badge, className)}>
      <CalendarOffIcon size={16} className={styles.icon} />
      <Text size="sm" weight="medium" color="dim">
        {LABEL[reason]}
      </Text>
    </Stack>
  );
}
