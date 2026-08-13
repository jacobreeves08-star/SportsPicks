import { SpinnerIcon } from "../icons/index.js";
import visuallyHiddenStyles from "../utils/visually-hidden.module.css";
import { cx } from "../utils/cx.js";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  size?: number;
  /** Announced to assistive tech via `role="status"` — customize for
   * context ("Loading standings") rather than leaving the generic
   * default when a screen has more than one spinner on it. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 20, label = "Loading", className }: SpinnerProps) {
  return (
    <span className={cx(styles.spinner, className)} role="status">
      <SpinnerIcon size={size} className={styles.spin} />
      <span className={visuallyHiddenStyles.visuallyHidden}>{label}</span>
    </span>
  );
}
