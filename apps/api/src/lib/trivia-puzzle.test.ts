import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { triviaQuestion } from "../db/schema.js";
import { createTestAthletePool, createTestNflAthlete, truncateAllTables } from "../db/test-helpers.js";
import { eq } from "drizzle-orm";
import {
  QUESTIONS_PER_PUZZLE,
  buildOptions,
  getOrCreatePuzzle,
  gradeAnswer,
  puzzleNumberFor,
  questionBelongsToPuzzle,
  seededRandom,
  shuffle,
  todayPuzzleDate,
} from "./trivia-puzzle.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("todayPuzzleDate — the fixed anchor timezone", () => {
  it("uses America/New_York, not UTC — the two disagree late in the evening", () => {
    // 03:00 UTC on the 2nd is still 23:00 on the 1st in New York. A
    // UTC-based day boundary would roll the puzzle over five hours
    // early for everyone in the US, mid-evening.
    const lateEvening = new Date("2026-08-02T03:00:00Z");
    expect(todayPuzzleDate(lateEvening)).toBe("2026-08-01");
  });

  it("rolls over at local midnight", () => {
    expect(todayPuzzleDate(new Date("2026-08-02T04:00:00Z"))).toBe("2026-08-02");
  });
});

describe("puzzleNumberFor", () => {
  it("numbers the epoch day 1", () => {
    expect(puzzleNumberFor("2026-08-01")).toBe(1);
  });

  it("counts calendar days forward", () => {
    expect(puzzleNumberFor("2026-08-15")).toBe(15);
  });

  it("keeps counting across a DST boundary rather than losing/gaining a day", () => {
    // US DST ends 2026-11-01. Day-diffing in a zoned calendar (not by
    // dividing milliseconds) is what makes this land on a whole number.
    expect(puzzleNumberFor("2026-11-02")).toBe(94);
  });
});

describe("seededRandom / shuffle", () => {
  it("is deterministic for the same seed", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], seededRandom("2026-08-01"));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], seededRandom("2026-08-01"));
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], seededRandom("2026-08-01"));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], seededRandom("2026-08-02"));
    expect(a).not.toEqual(b);
  });

  it("never mutates the input", () => {
    const input = [1, 2, 3];
    shuffle(input, seededRandom("seed"));
    expect(input).toEqual([1, 2, 3]);
  });
});

describe("buildOptions", () => {
  const pool = ["Alabama", "Ohio State", "LSU", "Michigan", "Georgia", "Texas"];

  it("produces five options containing the correct college exactly once", () => {
    const { options, answerIndex } = buildOptions("Alabama", pool, seededRandom("x"));
    expect(options).toHaveLength(5);
    expect(options.filter((o) => o === "Alabama")).toHaveLength(1);
    expect(options[answerIndex]).toBe("Alabama");
  });

  it("never repeats the correct answer as a distractor, even when a teammate shares the college", () => {
    // Two players from Alabama in the pool = "Alabama" appearing twice
    // in collegePool. Both must be filtered, or the question has two
    // right answers and is unanswerable.
    const dupes = ["Alabama", "Alabama", "Ohio State", "LSU", "Michigan", "Georgia"];
    const { options } = buildOptions("Alabama", dupes, seededRandom("x"));
    expect(options.filter((o) => o === "Alabama")).toHaveLength(1);
  });

  it("throws rather than serving a short question when the pool is too small", () => {
    expect(() => buildOptions("Alabama", ["Alabama", "LSU"], seededRandom("x"))).toThrow();
  });
});

describe("getOrCreatePuzzle", () => {
  it("builds five questions with five options each", async () => {
    await createTestAthletePool(10);

    const puzzle = await getOrCreatePuzzle("2026-08-10");

    expect(puzzle.questions).toHaveLength(QUESTIONS_PER_PUZZLE);
    expect(puzzle.puzzleNumber).toBe(10);
    for (const q of puzzle.questions) {
      expect(q.options).toHaveLength(5);
      expect(q.athlete.displayName).toBeTruthy();
    }
    expect(puzzle.questions.map((q) => q.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("NEVER exposes the correct answer in what it returns", async () => {
    await createTestAthletePool(10);
    const puzzle = await getOrCreatePuzzle("2026-08-10");

    // The whole feature depends on this: if the answer ships with the
    // question, the quiz is solvable from the network tab.
    const serialized = JSON.stringify(puzzle);
    expect(serialized).not.toContain("answerIndex");
    expect(serialized).not.toContain("answer_index");
    expect(serialized).not.toContain("collegeName");
  });

  it("is idempotent — a second call returns the identical puzzle, not a new one", async () => {
    await createTestAthletePool(10);

    const first = await getOrCreatePuzzle("2026-08-10");
    const second = await getOrCreatePuzzle("2026-08-10");

    expect(second.id).toBe(first.id);
    expect(second.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
  });

  it("gives two concurrent first-callers the same puzzle (unique constraint settles the race)", async () => {
    await createTestAthletePool(10);

    const [a, b] = await Promise.all([getOrCreatePuzzle("2026-08-10"), getOrCreatePuzzle("2026-08-10")]);

    expect(a.id).toBe(b.id);
    expect(a.questions.map((q) => q.id).sort()).toEqual(b.questions.map((q) => q.id).sort());
  });

  it("gives different days different players", async () => {
    await createTestAthletePool(30);

    const day1 = await getOrCreatePuzzle("2026-08-10");
    const day2 = await getOrCreatePuzzle("2026-08-11");

    expect(day2.questions.map((q) => q.athlete.displayName)).not.toEqual(
      day1.questions.map((q) => q.athlete.displayName),
    );
  });

  it("prefers active-roster players over practice-squad ones", async () => {
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ rosterStatus: "active", displayName: `Active ${i}` });
    }
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ rosterStatus: "practice_squad", displayName: `Scrub ${i}` });
    }

    const puzzle = await getOrCreatePuzzle("2026-08-10");

    expect(puzzle.questions.every((q) => q.athlete.displayName.startsWith("Active"))).toBe(true);
  });

  it("prefers depth-chart starters over active backups at the same positions", async () => {
    // Both groups are active skill-position players — the ONLY
    // difference is the depth-chart flag. This is the fix for "the
    // quiz picked players nobody has heard of": a third-string RB and
    // a franchise QB both match active+skill, only one is a starter.
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ isStarter: true, displayName: `Household Name ${i}` });
    }
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ isStarter: false, displayName: `Backup ${i}` });
    }

    const puzzle = await getOrCreatePuzzle("2026-08-10");

    expect(puzzle.questions.every((q) => q.athlete.displayName.startsWith("Household Name"))).toBe(true);
  });

  it("no longer treats kickers as a preferred position", async () => {
    // Even starting kickers are obscure outside a couple of names —
    // active WR backups should beat active starting kickers.
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ positionAbbreviation: "K", isStarter: true, displayName: `Kicker ${i}` });
    }
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ positionAbbreviation: "WR", isStarter: false, displayName: `Receiver ${i}` });
    }

    const puzzle = await getOrCreatePuzzle("2026-08-10");

    expect(puzzle.questions.every((q) => q.athlete.displayName.startsWith("Receiver"))).toBe(true);
  });

  it("falls back to non-skill positions rather than serving fewer than five questions", async () => {
    // Only long snappers and punters exist — tier 1 (skill positions)
    // finds nobody, so tier 2 must carry the whole puzzle.
    for (let i = 0; i < 8; i++) {
      await createTestNflAthlete({ positionAbbreviation: i % 2 === 0 ? "LS" : "P" });
    }

    const puzzle = await getOrCreatePuzzle("2026-08-10");
    expect(puzzle.questions).toHaveLength(QUESTIONS_PER_PUZZLE);
  });

  it("503s with a distinct code when the player pool hasn't been ingested yet", async () => {
    await expect(getOrCreatePuzzle("2026-08-10")).rejects.toMatchObject({
      code: "TRIVIA_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("503s when there are players but too few distinct colleges to build options", async () => {
    // Six players, all from one school: five questions are selectable
    // but no question can be given four distinct wrong answers.
    for (let i = 0; i < 6; i++) {
      await createTestNflAthlete({ collegeName: "Alabama" });
    }

    await expect(getOrCreatePuzzle("2026-08-10")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("gradeAnswer", () => {
  it("returns the correct index and college, and whether the pick matched", async () => {
    await createTestAthletePool(10);
    const puzzle = await getOrCreatePuzzle("2026-08-10");
    const question = puzzle.questions[0]!;

    const [stored] = await db
      .select({ answerIndex: triviaQuestion.answerIndex })
      .from(triviaQuestion)
      .where(eq(triviaQuestion.id, question.id));

    const right = await gradeAnswer(question.id, stored!.answerIndex);
    expect(right.correct).toBe(true);
    expect(right.correctCollege).toBe(question.options[stored!.answerIndex]);

    const wrong = await gradeAnswer(question.id, (stored!.answerIndex + 1) % 5);
    expect(wrong.correct).toBe(false);
    expect(wrong.correctIndex).toBe(stored!.answerIndex);
  });

  it("404s for an unknown question", async () => {
    await expect(gradeAnswer("00000000-0000-0000-0000-000000000000", 0)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("questionBelongsToPuzzle", () => {
  it("distinguishes today's questions from another day's", async () => {
    await createTestAthletePool(30);
    const today = await getOrCreatePuzzle("2026-08-10");
    const yesterday = await getOrCreatePuzzle("2026-08-09");

    expect(await questionBelongsToPuzzle(today.questions[0]!.id, today.id)).toBe(true);
    expect(await questionBelongsToPuzzle(yesterday.questions[0]!.id, today.id)).toBe(false);
  });
});
