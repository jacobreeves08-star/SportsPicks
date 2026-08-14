/**
 * The last calendar date (local device date, `YYYY-MM-DD`) the results
 * digest pop-up was shown — a DATE, not a boolean flag, since this one
 * repeats once per day rather than firing only once ever (contrast
 * `first-completion-tracker.ts`'s single `has-completed-a-slate` flag).
 * `ResultsDigestModal` mounts on every app-shell render and compares
 * today's date against this before deciding whether to fetch at all.
 */
const STORAGE_KEY = "sports-pickem:results-digest-last-shown-date";

/** The device's own local calendar date, `YYYY-MM-DD` — deliberately
 * NOT a league's timezone (there may be several, one per league; this
 * gate is about "have we already shown SOMETHING today," not about
 * any one league's day boundary) and deliberately not UTC either,
 * since "today" for this once-a-day UI gate should match what the
 * device's owner would call today. */
export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLastShownDate(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    // Corrupt/unavailable storage — treat as "never shown," same
    // defensive posture as every other localStorage-backed module in
    // this app (api/auth-store.ts, offline/queue.ts, first-completion-tracker.ts).
    return null;
  }
}

/** Called BEFORE the modal renders (same race-avoidance discipline as
 * `first-completion-tracker.ts`'s `markSlateCompleted()`) — a reload
 * that happens mid-prompt can never cause the digest to show twice in
 * one day, since the flag is already set before anything paints. */
export function markShownToday(date: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, date);
  } catch {
    /* storage unavailable/full — in-memory behavior for the rest of
     * this session is still correct; just won't survive a reload. */
  }
}

/** Test-only reset — never call from application code. */
export function resetResultsDigestTrackerForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
