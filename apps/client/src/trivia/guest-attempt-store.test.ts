import { beforeEach, describe, expect, it } from "vitest";
import { readGuestAttempt, recordGuestAnswer, resetGuestAttemptForTests } from "./guest-attempt-store.js";

const STORAGE_KEY = "sports-pickem:guest-trivia";

function answer(questionId: string, isCorrect = true) {
  return { questionId, selectedIndex: 0, isCorrect, correctIndex: 0 };
}

beforeEach(() => {
  resetGuestAttemptForTests();
  localStorage.clear();
});

describe("readGuestAttempt", () => {
  it("returns an empty attempt when nothing has been played", () => {
    expect(readGuestAttempt("puzzle-1")).toEqual({ puzzleId: "puzzle-1", answers: [] });
  });

  it("returns an empty attempt for a DIFFERENT puzzle than the stored one — yesterday's round isn't today's", () => {
    recordGuestAnswer("puzzle-1", answer("q1"));

    expect(readGuestAttempt("puzzle-2")).toEqual({ puzzleId: "puzzle-2", answers: [] });
  });

  it("survives corrupt storage instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, "not json at all");

    expect(readGuestAttempt("puzzle-1")).toEqual({ puzzleId: "puzzle-1", answers: [] });
  });

  it("drops malformed entries but keeps the well-formed ones", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        puzzleId: "puzzle-1",
        answers: [answer("q1"), { questionId: "q2" }, null, "nope"],
      }),
    );

    expect(readGuestAttempt("puzzle-1").answers).toEqual([answer("q1")]);
  });
});

describe("recordGuestAnswer", () => {
  it("appends answers in order", () => {
    recordGuestAnswer("puzzle-1", answer("q1"));
    const after = recordGuestAnswer("puzzle-1", answer("q2", false));

    expect(after.answers.map((a) => a.questionId)).toEqual(["q1", "q2"]);
    expect(after.answers[1]!.isCorrect).toBe(false);
  });

  it("persists across a fresh read — the point of the whole store", () => {
    recordGuestAnswer("puzzle-1", answer("q1"));

    expect(readGuestAttempt("puzzle-1").answers).toHaveLength(1);
  });

  it("IGNORES a repeat answer for a question already answered", () => {
    recordGuestAnswer("puzzle-1", answer("q1", false));
    const after = recordGuestAnswer("puzzle-1", answer("q1", true));

    // Same "you get one shot" rule the server enforces for logged-in
    // users — a guest can't retry a question to improve their score.
    expect(after.answers).toHaveLength(1);
    expect(after.answers[0]!.isCorrect).toBe(false);
  });

  it("replaces a previous day's stored round rather than appending to it", () => {
    recordGuestAnswer("puzzle-1", answer("q1"));
    const after = recordGuestAnswer("puzzle-2", answer("qA"));

    expect(after.puzzleId).toBe("puzzle-2");
    expect(after.answers.map((a) => a.questionId)).toEqual(["qA"]);
    expect(readGuestAttempt("puzzle-1").answers).toEqual([]);
  });
});
