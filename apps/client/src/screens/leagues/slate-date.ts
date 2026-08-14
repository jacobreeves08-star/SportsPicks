/**
 * Walks a plain calendar date string (`YYYY-MM-DD`, the slate
 * endpoint's own date shape) by `delta` days — UTC-anchored
 * arithmetic, not `new Date(dateStr)` + `setDate()`, which can drift
 * by a day depending on the browser's local timezone. This is
 * deliberately NOT a timezone conversion (the string already
 * represents a day in the league's own timezone, per
 * docs/picks-and-locking.md) — it's calendar-date-plus-N-days, full
 * stop, the same operation regardless of what timezone anyone is in.
 */
export function addDays(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}
