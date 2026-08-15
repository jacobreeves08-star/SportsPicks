import { describe, expect, it } from "vitest";
import { buildTriviaShareHtml, buildTriviaShareText, SHARE_LINK_LABEL } from "./build-trivia-share-text.js";

describe("buildTriviaShareText", () => {
  it("leads with the day number and the score", () => {
    const text = buildTriviaShareText({ puzzleNumber: 14, results: [true, true, false, true, false] });

    expect(text).toContain("Pick'em College Quiz #14");
    expect(text).toContain("3/5");
  });

  it("renders one square per question, in the order they were played", () => {
    const text = buildTriviaShareText({ puzzleNumber: 1, results: [true, false, true, true, false] });

    expect(text).toContain("🟩🟥🟩🟩🟥");
  });

  it("closes with a pitch to play, naming the score to beat", () => {
    const text = buildTriviaShareText({ puzzleNumber: 1, results: [true, false, true, true, false] });

    expect(text).toContain("think you can beat 3/5?");
  });

  it("dares a perfect round to be MATCHED — 5/5 cannot be beaten", () => {
    const text = buildTriviaShareText({ puzzleNumber: 1, results: [true, true, true, true, true] });

    expect(text).toContain("can you match 5/5?");
    expect(text).not.toContain("beat");
  });

  it("doesn't dare anyone to beat a shutout — that bar is no prize to clear", () => {
    const text = buildTriviaShareText({ puzzleNumber: 1, results: [false, false, false, false, false] });

    expect(text).toContain("it can only go up from here");
    expect(text).not.toContain("beat 0/5");
  });

  it("is SPOILER-SAFE — no player names and no colleges", () => {
    // The whole reason everyone gets the same five players is so a
    // friend can play the same quiz. A share that named them would
    // ruin the thing it's advertising, so the text is built only from
    // the day number and a boolean per question — there is no way for
    // a name to reach it.
    const text = buildTriviaShareText({ puzzleNumber: 7, results: [true, true, true, true, true] });

    expect(text).not.toMatch(/[Aa]labama|Ohio|LSU|college:/);
    expect(text.replace(/[🟩🟥]/gu, "")).not.toMatch(/\b(went|attended)\b/);
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

  it("carries no URL of its own — the caller decides how the link travels", () => {
    const text = buildTriviaShareText({ puzzleNumber: 3, results: [true, false, true] });

    expect(text).not.toContain("http");
  });
});

describe("buildTriviaShareHtml", () => {
  const INPUT = { puzzleNumber: 15, results: [true, true, true, false, false], url: "https://pickem.example/college-quiz" };

  it("links marketing copy instead of showing the address", () => {
    const html = buildTriviaShareHtml(INPUT);

    expect(html).toContain(`<a href="https://pickem.example/college-quiz">${SHARE_LINK_LABEL}</a>`);
    // The URL appears exactly once — in the href, never as visible text.
    expect(html.replace(/href="[^"]*"/, "")).not.toContain("https://pickem.example");
  });

  it("carries the same score, squares and pitch as the plain-text version", () => {
    const html = buildTriviaShareHtml(INPUT);

    expect(html).toContain("Pick'em College Quiz #15 — 3/5");
    expect(html).toContain("🟩🟩🟩🟥🟥");
    expect(html).toContain("think you can beat 3/5?");
  });

  it("turns the line breaks into markup rather than shipping raw newlines", () => {
    const html = buildTriviaShareHtml(INPUT);

    expect(html).not.toContain("\n");
    expect(html).toContain("<br>");
  });

  it("escapes the URL rather than trusting it — this lands on a system clipboard", () => {
    const html = buildTriviaShareHtml({ ...INPUT, url: `https://evil.example/"><script>alert(1)</script>` });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
