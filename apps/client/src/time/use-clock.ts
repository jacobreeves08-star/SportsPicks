import { useEffect, useState } from "react";
import { correctedNow, onClockSync } from "./server-clock.js";

/**
 * Live, corrected clock for anything that renders a countdown or a
 * live "time until lock" display. Ticks every `intervalMs` (default
 * 1s — enough for a countdown, not so often it burns battery) using
 * `correctedNow()`, never `Date.now()` — see server-clock.ts.
 *
 * Also re-renders IMMEDIATELY on any new sync sample (not just on the
 * next tick) — a resync should visibly correct a countdown right
 * away, not up to a full tick interval later.
 */
export function useCorrectedNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => correctedNow());

  useEffect(() => {
    const tick = () => setNow(correctedNow());
    const interval = setInterval(tick, intervalMs);
    const unsubscribe = onClockSync(tick);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [intervalMs]);

  return now;
}
