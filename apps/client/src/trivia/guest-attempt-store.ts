/**
 * A logged-out visitor's progress on today's college quiz, kept in
 * `localStorage` — the guest-side stand-in for the `trivia_attempt`
 * row a logged-in user gets server-side.
 *
 * **This is not enforcement, and it isn't pretending to be.** Clearing
 * site data, opening a private window, or switching browsers all reset
 * it, and there is no way around that for someone with no account: the
 * server has nothing to key an attempt to. What it DOES buy is the
 * honest, common-case behavior — a guest who finishes the round and
 * refreshes the page sees their result again instead of an invitation
 * to farm a better score. Anyone who wants their streak actually
 * defended has a real answer available, which is to log in (see
 * routes/trivia.routes.ts, where the same round IS enforced).
 *
 * Same shape and same defensive-read discipline as
 * `api/auth-store.ts` and `leagues/current-league-store.ts`: a tiny
 * standalone store, never throwing out of a module load.
 */

const STORAGE_KEY = "sports-pickem:guest-trivia";

export interface GuestAnswer {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
}

export interface GuestAttempt {
  /** The puzzle these answers belong to. A stored attempt for a
   * DIFFERENT puzzle is ignored (and overwritten) rather than
   * migrated — that's just yesterday's round, and today is a new one. */
  puzzleId: string;
  answers: GuestAnswer[];
}

function readStore(): GuestAttempt | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { puzzleId, answers } = parsed as Record<string, unknown>;
    if (typeof puzzleId !== "string" || !Array.isArray(answers)) return null;

    const valid: GuestAnswer[] = [];
    for (const entry of answers) {
      if (typeof entry !== "object" || entry === null) continue;
      const { questionId, selectedIndex, isCorrect, correctIndex } = entry as Record<string, unknown>;
      if (
        typeof questionId === "string" &&
        typeof selectedIndex === "number" &&
        typeof isCorrect === "boolean" &&
        typeof correctIndex === "number"
      ) {
        valid.push({ questionId, selectedIndex, isCorrect, correctIndex });
      }
    }
    return { puzzleId, answers: valid };
  } catch {
    // Corrupt or unavailable storage (private browsing, quota, a
    // hand-edited value) — treat exactly like "hasn't played today".
    return null;
  }
}

function writeStore(attempt: GuestAttempt): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    /* Storage unavailable/full — the in-memory round still plays
     * through correctly; it just won't survive a reload. */
  }
}

/** Today's stored answers, or an empty attempt when the stored one is
 * for a different (older) puzzle. */
export function readGuestAttempt(puzzleId: string): GuestAttempt {
  const stored = readStore();
  if (!stored || stored.puzzleId !== puzzleId) return { puzzleId, answers: [] };
  return stored;
}

/** Appends one answer. A repeat for a question already answered is
 * IGNORED rather than overwritten — the same "you get one shot" rule
 * the server enforces for logged-in users, applied client-side so the
 * two paths behave identically for anyone not actively working around
 * it. */
export function recordGuestAnswer(puzzleId: string, answer: GuestAnswer): GuestAttempt {
  const current = readGuestAttempt(puzzleId);
  if (current.answers.some((a) => a.questionId === answer.questionId)) return current;

  const next: GuestAttempt = { puzzleId, answers: [...current.answers, answer] };
  writeStore(next);
  return next;
}

export function resetGuestAttemptForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
