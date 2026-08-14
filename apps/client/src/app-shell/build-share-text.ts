import type { ResultsDigestEntry } from "../api/types.js";

/**
 * The one place the results-digest share text is composed — both
 * `ShareResultsButton`'s native-share path and its copy/email fallback
 * read from this, so the three can never say something different for
 * the same digest. Deliberately plain text (no per-league dates,
 * since leagues can disagree on what calendar day "yesterday" was —
 * see `docs/notifications.md`), matching the shipped example verbatim:
 * "Yesterday in Pick'em: 3-1 in AFC League, 2-2 in Friends League 🏈".
 */
export function buildShareText(entries: ResultsDigestEntry[]): string {
  const parts = entries.map((entry) => `${entry.wins}-${entry.losses} in ${entry.leagueName}`);
  return `Yesterday in Pick'em: ${parts.join(", ")} 🏈`;
}
