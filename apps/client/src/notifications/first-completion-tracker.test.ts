import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasEverCompletedASlate, markSlateCompleted, resetFirstCompletionForTests } from "./first-completion-tracker.js";

beforeEach(() => {
  resetFirstCompletionForTests();
});

afterEach(() => {
  resetFirstCompletionForTests();
});

describe("first-completion-tracker", () => {
  it("has never completed a slate initially", () => {
    expect(hasEverCompletedASlate()).toBe(false);
  });

  it("remembers completion once marked", () => {
    markSlateCompleted();
    expect(hasEverCompletedASlate()).toBe(true);
  });

  it("survives being marked twice without error", () => {
    markSlateCompleted();
    markSlateCompleted();
    expect(hasEverCompletedASlate()).toBe(true);
  });

  it("persists in localStorage directly (survives a simulated reload)", () => {
    markSlateCompleted();
    expect(localStorage.getItem("sports-pickem:has-completed-a-slate")).toBe("true");
  });
});
