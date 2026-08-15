import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { triviaQuestion } from "../db/schema.js";
import { createTestAthletePool, createTestUser, truncateAllTables } from "../db/test-helpers.js";
import { createSession } from "../lib/session.js";

let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = buildApp();
});

async function tokenFor(userId: string) {
  const { accessToken } = await createSession(userId);
  return accessToken;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** The one place a test is allowed to look up the right answer — it
 * reads it straight from the DB, exactly because no API response will
 * ever tell it. */
async function correctIndexFor(questionId: string): Promise<number> {
  const [row] = await db
    .select({ answerIndex: triviaQuestion.answerIndex })
    .from(triviaQuestion)
    .where(eq(triviaQuestion.id, questionId));
  return row!.answerIndex;
}

describe("GET /trivia/daily", () => {
  it("serves today's five questions to a caller with NO account at all", async () => {
    await createTestAthletePool(12);

    const res = await app.inject({ method: "GET", url: "/trivia/daily" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questions).toHaveLength(5);
    expect(body.questionCount).toBe(5);
    expect(body.puzzleNumber).toBeGreaterThan(0);
    // Honest about not saving anything, rather than silently dropping it.
    expect(body.tracked).toBe(false);
    expect(body.attempt).toBeNull();
  });

  it("does not leak the correct answer in the response body", async () => {
    await createTestAthletePool(12);

    const res = await app.inject({ method: "GET", url: "/trivia/daily" });

    const raw = res.body;
    expect(raw).not.toContain("answerIndex");
    expect(raw).not.toContain("correctCollege");
    for (const q of res.json().questions) {
      expect(Object.keys(q)).toEqual(["id", "position", "athlete", "options"]);
      expect(q.options).toHaveLength(5);
    }
  });

  it("gives an authenticated caller the same puzzle, marked as tracked", async () => {
    await createTestAthletePool(12);
    const user = await createTestUser();
    const token = await tokenFor(user.id);

    const anon = await app.inject({ method: "GET", url: "/trivia/daily" });
    const authed = await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) });

    expect(authed.json().puzzleId).toBe(anon.json().puzzleId);
    expect(authed.json().questions.map((q: { id: string }) => q.id)).toEqual(
      anon.json().questions.map((q: { id: string }) => q.id),
    );
    expect(authed.json().tracked).toBe(true);
  });

  it("gives two different users the identical five players — the whole point of a shared score", async () => {
    await createTestAthletePool(30);
    const a = await tokenFor((await createTestUser()).id);
    const b = await tokenFor((await createTestUser()).id);

    const resA = await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(a) });
    const resB = await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(b) });

    expect(resA.json().questions.map((q: { id: string }) => q.id)).toEqual(
      resB.json().questions.map((q: { id: string }) => q.id),
    );
  });

  it("503s (not 500) when the player pool hasn't been ingested yet", async () => {
    const res = await app.inject({ method: "GET", url: "/trivia/daily" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("TRIVIA_UNAVAILABLE");
  });
});

describe("POST /trivia/daily/answers", () => {
  it("grades a logged-out caller's answer without persisting anything", async () => {
    await createTestAthletePool(12);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily" })).json();
    const question = daily.questions[0];
    const answerIndex = await correctIndexFor(question.id);

    const res = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      payload: { questionId: question.id, selectedIndex: answerIndex },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      correct: true,
      correctIndex: answerIndex,
      correctCollege: question.options[answerIndex],
      tracked: false,
      attempt: null,
    });
  });

  it("echoes the caller's own choice back to a LOGGED-OUT caller too", async () => {
    // Regression: this was omitted on the anonymous path, so a guest
    // saw the right answer highlighted with no marker on what THEY
    // picked. Caught in the browser, not by the original tests.
    await createTestAthletePool(12);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily" })).json();
    const question = daily.questions[0];
    const wrong = ((await correctIndexFor(question.id)) + 1) % 5;

    const res = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      payload: { questionId: question.id, selectedIndex: wrong },
    });

    expect(res.json().selectedIndex).toBe(wrong);
  });

  it("reports a wrong answer as wrong, and reveals what the right one was", async () => {
    await createTestAthletePool(12);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily" })).json();
    const question = daily.questions[0];
    const answerIndex = await correctIndexFor(question.id);
    const wrong = (answerIndex + 1) % 5;

    const res = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      payload: { questionId: question.id, selectedIndex: wrong },
    });

    expect(res.json().correct).toBe(false);
    expect(res.json().correctIndex).toBe(answerIndex);
  });

  it("records an authenticated caller's answers and keeps a running tally", async () => {
    await createTestAthletePool(12);
    const token = await tokenFor((await createTestUser()).id);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();

    for (const [i, question] of daily.questions.entries()) {
      const answerIndex = await correctIndexFor(question.id);
      // Get the first three right, the last two wrong.
      const selected = i < 3 ? answerIndex : (answerIndex + 1) % 5;
      const res = await app.inject({
        method: "POST",
        url: "/trivia/daily/answers",
        headers: auth(token),
        payload: { questionId: question.id, selectedIndex: selected },
      });
      expect(res.json().tracked).toBe(true);
      expect(res.json().attempt.answeredCount).toBe(i + 1);
    }

    const final = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();
    expect(final.attempt).toMatchObject({ correctCount: 3, answeredCount: 5, completed: true });
  });

  it("refuses to let a replayed answer change the score — one shot per player, per day", async () => {
    await createTestAthletePool(12);
    const token = await tokenFor((await createTestUser()).id);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();
    const question = daily.questions[0];
    const answerIndex = await correctIndexFor(question.id);

    // Answer wrong first...
    await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      headers: auth(token),
      payload: { questionId: question.id, selectedIndex: (answerIndex + 1) % 5 },
    });

    // ...then try again with the right one, now that the response has
    // revealed it.
    const retry = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      headers: auth(token),
      payload: { questionId: question.id, selectedIndex: answerIndex },
    });

    expect(retry.statusCode).toBe(200);
    // The stored (wrong) answer wins, and the tally never moved.
    expect(retry.json().correct).toBe(false);
    expect(retry.json().attempt).toMatchObject({ correctCount: 0, answeredCount: 1 });
  });

  it("survives two identical answers racing, without double-counting", async () => {
    await createTestAthletePool(12);
    const token = await tokenFor((await createTestUser()).id);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();
    const question = daily.questions[0];
    const answerIndex = await correctIndexFor(question.id);

    await Promise.all([
      app.inject({
        method: "POST",
        url: "/trivia/daily/answers",
        headers: auth(token),
        payload: { questionId: question.id, selectedIndex: answerIndex },
      }),
      app.inject({
        method: "POST",
        url: "/trivia/daily/answers",
        headers: auth(token),
        payload: { questionId: question.id, selectedIndex: answerIndex },
      }),
    ]);

    const after = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();
    expect(after.attempt).toMatchObject({ answeredCount: 1, correctCount: 1 });
  });

  it("404s a question that isn't part of today's puzzle", async () => {
    await createTestAthletePool(12);
    await app.inject({ method: "GET", url: "/trivia/daily" });

    const res = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      payload: { questionId: "00000000-0000-0000-0000-000000000000", selectedIndex: 0 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects an out-of-range option index", async () => {
    await createTestAthletePool(12);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily" })).json();

    const res = await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      payload: { questionId: daily.questions[0].id, selectedIndex: 9 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("keeps two users' attempts entirely separate on the same puzzle", async () => {
    await createTestAthletePool(12);
    const tokenA = await tokenFor((await createTestUser()).id);
    const tokenB = await tokenFor((await createTestUser()).id);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily" })).json();
    const question = daily.questions[0];
    const answerIndex = await correctIndexFor(question.id);

    await app.inject({
      method: "POST",
      url: "/trivia/daily/answers",
      headers: auth(tokenA),
      payload: { questionId: question.id, selectedIndex: answerIndex },
    });

    const forB = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(tokenB) })).json();
    expect(forB.attempt).toBeNull();
  });
});

describe("GET /trivia/me/stats", () => {
  it("requires authentication — there is no anonymous history", async () => {
    const res = await app.inject({ method: "GET", url: "/trivia/me/stats" });
    expect(res.statusCode).toBe(401);
  });

  it("reflects a completed round", async () => {
    await createTestAthletePool(12);
    const token = await tokenFor((await createTestUser()).id);
    const daily = (await app.inject({ method: "GET", url: "/trivia/daily", headers: auth(token) })).json();

    for (const question of daily.questions) {
      await app.inject({
        method: "POST",
        url: "/trivia/daily/answers",
        headers: auth(token),
        payload: { questionId: question.id, selectedIndex: await correctIndexFor(question.id) },
      });
    }

    const stats = (await app.inject({ method: "GET", url: "/trivia/me/stats", headers: auth(token) })).json();

    expect(stats).toMatchObject({
      daysPlayed: 1,
      currentStreak: 1,
      bestStreak: 1,
      totalCorrect: 5,
      totalAnswered: 5,
      accuracyPct: 100,
      perfectDays: 1,
    });
    expect(stats.recent[0]).toMatchObject({ correctCount: 5, completed: true });
  });

  it("is empty for a user who has never played", async () => {
    const token = await tokenFor((await createTestUser()).id);
    const stats = (await app.inject({ method: "GET", url: "/trivia/me/stats", headers: auth(token) })).json();
    expect(stats).toMatchObject({ daysPlayed: 0, currentStreak: 0, accuracyPct: null, recent: [] });
  });
});
