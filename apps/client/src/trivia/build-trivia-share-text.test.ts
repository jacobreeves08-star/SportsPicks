import { describe, expect, it } from "vitest";
import { buildTriviaShareText } from "./build-trivia-share-text.js";

describe("buildTriviaShareText", () => {
  it("leads with the day number and the score", () => {
    const text = buildTriviaShareText({ puzzleNumber: 14, results: [true, true, false, true, false] });

    expect(text).toContain("Pick'em College Quiz #14");
    expect(text).toContain("3/5");
  });

  it("renders one square per question, in the order they were played", () => {
    const text = buildTriviaShareText({ puzzleNumber: 1, results: [true, false, true, true, false] });

    expect(text).toContain("🟩⬜🟩🟩⬜");
  });

  it("is SPOILER-SAFE — no player names and no colleges", () => {
    // The whole reason everyone gets the same five players is so a
    // friend can play the same quiz. A share that named them would
    // ruin the thing it's advertising, so the text is built only from
    // the day number and a boolean per question — there is no way for
    // a name to reach it.
    const text = buildTriviaShareText({ puzzleNumber: 7, results: [true, true, true, true, true] });

    expect(text).not.toMatch(/[Aa]labama|Ohio|LSU|college:/);
    expect(text.replace(/[🟩⬜]/gu, "")).not.toMatch(/\b(went|attended)\b/);
  });

  it("handles a perfect round and a zero alike", () => {
    expect(buildTriviaShareText({ puzzleNumber: 2, results: [true, true, true, true, true] })).toContain("5/5");
    expect(buildTriviaShareText({ puzzleNumber: 2, results: [false, false, false, false, false] })).toContain("0/5");
  });

  it("scores against however many questions were actually played", () => {
    // Not hardcoded to five — the round length lives in the API's
    // QUESTIONS_PER_PUZZLE, and this must follow it, not restate it.
    expect(buildTriviaShareText({ puzzleNumber: 3, results: [true, false, true] })).toContain("2/3");
  });
});
