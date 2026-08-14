/**
 * Whether this browser has EVER seen a fully-completed slate — the
 * gate for the one-time "ask for notification permission" prompt
 * (Epic 10 brief: after first slate completion, never cold). A plain
 * `localStorage` flag, not React state: `use-first-completion-prompt.ts`
 * needs to check-and-set this atomically the moment a qualifying
 * event arrives, so the prompt can never fire twice — including
 * across a reload that happens mid-prompt, before the user has
 * responded.
 */
const STORAGE_KEY = "sports-pickem:has-completed-a-slate";

export function hasEverCompletedASlate(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Corrupt/unavailable storage — treat as "never completed," same
    // defensive posture as every other localStorage-backed module in
    // this app (api/auth-store.ts, offline/queue.ts, ...).
    return false;
  }
}

export function markSlateCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    /* storage unavailable/full — in-memory behavior for the rest of
     * this session is still correct; just won't survive a reload. */
  }
}

/** Test-only reset — never call from application code. */
export function resetFirstCompletionForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
