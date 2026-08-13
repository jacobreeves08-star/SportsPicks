import { cx } from "../utils/cx.js";
import visuallyHiddenStyles from "../utils/visually-hidden.module.css";
import styles from "./Countdown.module.css";
import { NumericText, type NumericTextProps } from "./NumericText.js";

/**
 * PURE — takes `remainingMs` as a prop. Does NOT call
 * `useCorrectedNow()` itself; a container (Epic 10/11) is responsible
 * for computing `remainingMs` from `correctedNow()`, never
 * `Date.now()` (see time/server-clock.ts) and re-rendering this on
 * every tick. Keeping the clock dependency out of this component is
 * what makes it Storybook-mockable with a static `remainingMs`.
 */
export interface CountdownProps {
  remainingMs: number;
  size?: NumericTextProps["size"];
  weight?: NumericTextProps["weight"];
  color?: NumericTextProps["color"];
  className?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * A coarse, screen-reader-friendly equivalent of the ticking numeral
 * — "about 5 minutes," not a fresh announcement every second. A
 * countdown re-rendering (and thus re-announcing) on every tick would
 * be unusable noise for assistive tech; this text only meaningfully
 * changes once a minute (or once an hour, near the top of the range).
 */
function describeDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds === 0) return "Locks now";
  if (totalSeconds < 60) return "Locks in less than a minute";

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `Locks in about ${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return minutes === 0 ? `Locks in about ${hourPart}` : `Locks in about ${hourPart} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function Countdown({ remainingMs, size, weight, color, className }: CountdownProps) {
  return (
    <span className={cx(styles.countdown, className)}>
      <NumericText size={size} weight={weight} color={color}>
        <span aria-hidden="true">{formatDuration(remainingMs)}</span>
      </NumericText>
      <span className={visuallyHiddenStyles.visuallyHidden}>{describeDuration(remainingMs)}</span>
    </span>
  );
}
