import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { triviaAttempt, triviaPuzzle } from "../db/schema.js";
import { createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { computeStreaks, getTriviaStats } from "./trivia-stats.js";

beforeEach(async () => {
  await truncateAllTables();
});

describe("computeStreaks", () => {
  it("counts consecutive days ending today", () => {
    const played = ["2026-08-12", "2026-08-13", "2026-08-14"];
    expect(computeStreaks(played, "2026-08-14")).toEqual({ currentStreak: 3, bestStreak: 3 });
  });

  it("keeps a streak alive on a day not yet played — it isn't broken until the day is over", () => {
    // The user played through yesterday and it's now 9am. Showing 0
    // all morning would be wrong: they haven't missed anything yet.
    const played = ["2026-08-12", "2026-08-13"];
    expect(computeStreaks(played, "2026-08-14").currentStreak).toBe(2);
  });

  it("breaks the streak once a full day has been skipped", () => {
    const played = ["2026-08-11", "2026-08-12"];
    expect(computeStreaks(played, "2026-08-14").currentStreak).toBe(0);
  });

  it("reports 0 for a user who has never played", () => {
    expect(computeStreaks([], "2026-08-14")).toEqual({ currentStreak: 0, bestStreak: 0 });
  });

  it("remembers a longer past streak as the best, even after it broke", () => {
    const played = [
      "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05",
      // gap
      "2026-08-13", "2026-08-14",
    ];
    expect(computeStreaks(played, "2026-08-14")).toEqual({ currentStreak: 2, bestStreak: 5 });
  });

  it("counts a streak correctly across a month boundary", () => {
    const played = ["2026-07-30", "2026-07-31", "2026-08-01"];
    expect(computeStreaks(played, "2026-08-01").currentStreak).toBe(3);
  });

  it("counts a streak correctly across the DST change", () => {
    // US DST ends 2026-11-01 — a 25-hour day. Date arithmetic done in
    // milliseconds rather than calendar days would drop this to 2.
    const played = ["2026-10-31", "2026-11-01", "2026-11-02"];
    expect(computeStreaks(played, "2026-11-02").currentStreak).toBe(3);
  });

  it("is unfazed by duplicate or unsorted input", () => {
    const played = ["2026-08-14", "2026-08-12", "2026-08-13", "2026-08-13"];
    expect(computeStreaks(played, "2026-08-14")).toEqual({ currentStreak: 3, bestStreak: 3 });
  });
});

async function seedAttempt(userId: string, date: string, number: number, correct: number, answered: number) {
  const [puzzle] = await db
    .insert(triviaPuzzle)
    .values({ puzzleDate: date, puzzleNumber: number })
    .returning();
  await db.insert(triviaAttempt).values({
    userId,
    puzzleId: puzzle!.id,
    correctCount: correct,
    answeredCount: answered,
    completedAt: answered === 5 ? new Date() : null,
  });
}

describe("getTriviaStats", () => {
  it("returns an empty-but-valid shape for a user who has never played", async () => {
    const user = await createTestUser();
    const stats = await getTriviaStats(user.id);

    expect(stats).toMatchObject({
      daysPlayed: 0,
      currentStreak: 0,
      bestStreak: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      perfectDays: 0,
      recent: [],
    });
    // null, not 0 — "no data" and "0% accuracy" render differently.
    expect(stats.accuracyPct).toBeNull();
  });

  it("aggregates totals, accuracy, and perfect days", async () => {
    const user = await createTestUser();
    const now = new Date("2026-08-14T18:00:00Z");
    await seedAttempt(user.id, "2026-08-12", 12, 5, 5);
    await seedAttempt(user.id, "2026-08-13", 13, 3, 5);
    await seedAttempt(user.id, "2026-08-14", 14, 4, 5);

    const stats = await getTriviaStats(user.id, now);

    expect(stats.daysPlayed).toBe(3);
    expect(stats.totalCorrect).toBe(12);
    expect(stats.totalAnswered).toBe(15);
    expect(stats.accuracyPct).toBe(80);
    expect(stats.perfectDays).toBe(1);
    expect(stats.currentStreak).toBe(3);
  });

  it("orders the recent strip newest-first", async () => {
    const user = await createTestUser();
    await seedAttempt(user.id, "2026-08-12", 12, 1, 5);
    await seedAttempt(user.id, "2026-08-14", 14, 2, 5);
    await seedAttempt(user.id, "2026-08-13", 13, 3, 5);

    const stats = await getTriviaStats(user.id, new Date("2026-08-14T18:00:00Z"));

    expect(stats.recent.map((r) => r.date)).toEqual(["2026-08-14", "2026-08-13", "2026-08-12"]);
  });

  it("counts a partially-answered day as played, and marks it not completed", async () => {
    const user = await createTestUser();
    await seedAttempt(user.id, "2026-08-14", 14, 2, 3);

    const stats = await getTriviaStats(user.id, new Date("2026-08-14T18:00:00Z"));

    expect(stats.daysPlayed).toBe(1);
    expect(stats.currentStreak).toBe(1);
    expect(stats.totalAnswered).toBe(3);
    expect(stats.recent[0]).toMatchObject({ completed: false, correctCount: 2, answeredCount: 3 });
  });

  it("ignores an attempt row that was opened but never answered", async () => {
    const user = await createTestUser();
    await seedAttempt(user.id, "2026-08-14", 14, 0, 0);

    const stats = await getTriviaStats(user.id, new Date("2026-08-14T18:00:00Z"));

    expect(stats.daysPlayed).toBe(0);
    expect(stats.currentStreak).toBe(0);
  });

  it("never mixes in another user's attempts", async () => {
    const mine = await createTestUser();
    const theirs = await createTestUser();
    const [puzzle] = await db.insert(triviaPuzzle).values({ puzzleDate: "2026-08-14", puzzleNumber: 14 }).returning();
    await db.insert(triviaAttempt).values({ userId: mine.id, puzzleId: puzzle!.id, correctCount: 1, answeredCount: 5 });
    await db.insert(triviaAttempt).values({ userId: theirs.id, puzzleId: puzzle!.id, correctCount: 5, answeredCount: 5 });

    const stats = await getTriviaStats(mine.id, new Date("2026-08-14T18:00:00Z"));

    expect(stats.totalCorrect).toBe(1);
    expect(stats.daysPlayed).toBe(1);
  });
});
