import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SlateResponse } from "../api/types.js";
import { resetFirstCompletionForTests } from "./first-completion-tracker.js";
import { notifyPossibleSlateCompletion, resetNotificationPromptBusForTests } from "./notification-prompt-bus.js";
import { useFirstCompletionPrompt } from "./use-first-completion-prompt.js";

function slate(pickedCount: number, totalCount: number): SlateResponse {
  return { date: "2026-08-13", games: [], pickedCount, totalCount };
}

beforeEach(() => {
  resetFirstCompletionForTests();
  resetNotificationPromptBusForTests();
});

afterEach(() => {
  resetFirstCompletionForTests();
  resetNotificationPromptBusForTests();
});

describe("useFirstCompletionPrompt", () => {
  it("starts false", () => {
    const { result } = renderHook(() => useFirstCompletionPrompt());
    expect(result.current).toBe(false);
  });

  it("flips true when a slate transitions to fully picked for the first time", () => {
    const { result } = renderHook(() => useFirstCompletionPrompt());

    act(() => {
      notifyPossibleSlateCompletion(slate(3, 3));
    });

    expect(result.current).toBe(true);
  });

  it("ignores a partially-picked slate", () => {
    const { result } = renderHook(() => useFirstCompletionPrompt());

    act(() => {
      notifyPossibleSlateCompletion(slate(2, 3));
    });

    expect(result.current).toBe(false);
  });

  it("ignores an empty slate (totalCount 0) — nothing was actually completed", () => {
    const { result } = renderHook(() => useFirstCompletionPrompt());

    act(() => {
      notifyPossibleSlateCompletion(slate(0, 0));
    });

    expect(result.current).toBe(false);
  });

  it("never fires a second time, even for a fresh hook instance (simulating a reload)", () => {
    const first = renderHook(() => useFirstCompletionPrompt());
    act(() => {
      notifyPossibleSlateCompletion(slate(3, 3));
    });
    expect(first.result.current).toBe(true);
    first.unmount();

    // A fresh mount — like after a page reload — must NOT prompt
    // again, even if another "fully picked" event arrives.
    const second = renderHook(() => useFirstCompletionPrompt());
    act(() => {
      notifyPossibleSlateCompletion(slate(2, 2));
    });
    expect(second.result.current).toBe(false);
  });
});
