import type { SlateResponse } from "../api/types.js";

/**
 * A tiny pub/sub, same shape as `api/auth-store.ts`'s
 * `emitSessionExpired`/`onSessionExpired` — the shell (this epic) has
 * no slate data of its own to observe (screens stay placeholders),
 * but `use-first-completion-prompt.ts` still needs to react the
 * moment one becomes fully picked. A future slate screen (Epic 11)
 * calls `notifyPossibleSlateCompletion(slate)` from a `useEffect`
 * after `useSlate()` resolves — zero coupling to the shell's React
 * tree, matching this repo's established "call an emit function, the
 * interested layer subscribes" pattern.
 */
const listeners = new Set<(slate: SlateResponse) => void>();

export function notifyPossibleSlateCompletion(slate: SlateResponse): void {
  for (const listener of listeners) listener(slate);
}

export function onPossibleSlateCompletion(listener: (slate: SlateResponse) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only reset — never call from application code. */
export function resetNotificationPromptBusForTests(): void {
  listeners.clear();
}
