import { Stack } from "../primitives/Stack.js";
import { Surface } from "../primitives/Surface.js";
import { cx } from "../utils/cx.js";
import styles from "./LoadingState.module.css";

export interface LoadingStateProps {
  /** Number of skeleton rows — match the caller's typical slate size
   * so the layout doesn't visibly jump once real rows arrive. */
  rows?: number;
  label?: string;
  className?: string;
}

/**
 * A skeleton slate — reads as "already loading something row-shaped,"
 * not a generic centered spinner, on the theory that it feels faster
 * on bad wifi (Epic 9's design target). Distinct from `StaleBanner`:
 * this is "not here yet," that one is "here, but known-old" — never
 * conflate the two, per the brief's explicit requirement.
 */
export function LoadingState({ rows = 3, label = "Loading slate", className }: LoadingStateProps) {
  return (
    <div role="status" aria-label={label} className={className}>
      <Stack gap={2} aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <Surface key={i} variant="raised" padding={3} radius="md" className={styles.row}>
            <div className={cx(styles.bar)} style={{ width: "55%" }} />
            <div className={cx(styles.bar)} style={{ width: "30%" }} />
          </Surface>
        ))}
      </Stack>
    </div>
  );
}
