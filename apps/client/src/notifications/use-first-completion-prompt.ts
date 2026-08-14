import { useEffect, useState } from "react";
import { hasEverCompletedASlate, markSlateCompleted } from "./first-completion-tracker.js";
import { onPossibleSlateCompletion } from "./notification-prompt-bus.js";

/**
 * Returns `true` exactly once, ever, the moment a slate transitions
 * to fully picked for the FIRST TIME (Epic 10 brief: ask after first
 * slate completion, never cold). `markSlateCompleted()` is called
 * IMMEDIATELY on that qualifying event, before this hook's state even
 * updates — so a reload that happens mid-prompt (before the user
 * responds to the permission dialog) can never cause a second prompt;
 * the flag is already set.
 */
export function useFirstCompletionPrompt(): boolean {
  const [shouldPrompt, setShouldPrompt] = useState(false);

  useEffect(() => {
    return onPossibleSlateCompletion((slate) => {
      if (slate.totalCount === 0) return;
      if (slate.pickedCount !== slate.totalCount) return;
      if (hasEverCompletedASlate()) return;

      markSlateCompleted();
      setShouldPrompt(true);
    });
  }, []);

  return shouldPrompt;
}
