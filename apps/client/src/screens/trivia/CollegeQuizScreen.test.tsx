import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { DailyTrivia, OpsSummary, TriviaAnswerResponse, UserProfile } from "../../api/types.js";
import { resetCurrentLeagueForTests } from "../../leagues/current-league-store.js";
import { resetGuestAttemptForTests } from "../../trivia/guest-attempt-store.js";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({
  getDailyTrivia: vi.fn(),
  answerDailyTrivia: vi.fn(),
  getTriviaStats: vi.fn(),
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
}));

const PROFILE: UserProfile = {
  id: "user-1",
  email: "a@example.com",
  displayName: "Test",
  timezone: "America/Chicago",
  avatarUrl: null,
  emailVerifiedAt: "2026-08-13T00:00:00.000Z",
  pendingEmail: null,
  deletionRequestedAt: null,
  scheduledDeletionAt: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  notificationsEnabled: true,
};

const HEALTHY_SUMMARY: OpsSummary = {
  jobs: [],
  staleGameCount: 0,
  correctionsLast24h: 0,
  signupsLast24h: 0,
  picksLast24h: 0,
  slateCompletionRates: [],
  generatedAt: "2026-08-13T18:00:00.000Z",
};

const COLLEGES = ["Alabama", "Ohio State", "LSU", "Michigan", "Georgia"];

function daily(overrides: Partial<DailyTrivia> = {}): DailyTrivia {
  return {
    puzzleId: "puzzle-1",
    date: "2026-08-14",
    puzzleNumber: 14,
    questionCount: 5,
    questions: Array.from({ length: 5 }, (_, i) => ({
      id: `q${i + 1}`,
      position: i + 1,
      athlete: {
        displayName: `Player ${i + 1}`,
        positionAbbreviation: "QB",
        jersey: `${i + 1}`,
        headshotUrl: null,
        teamDisplayName: "Test Team",
      },
      options: COLLEGES,
    })),
    tracked: false,
    attempt: null,
    ...overrides,
  };
}

/** The server's grading response. `correctIndex: 0` throughout, so
 * "Alabama" is always the right answer in these tests. */
function graded(questionId: string, selectedIndex: number, overrides: Partial<TriviaAnswerResponse> = {}): TriviaAnswerResponse {
  return {
    questionId,
    correct: selectedIndex === 0,
    correctIndex: 0,
    correctCollege: "Alabama",
    selectedIndex,
    tracked: false,
    attempt: null,
    ...overrides,
  };
}

/** A finished five-question round with `correctCount` of them right —
 * the shortest way onto the result card without playing through it. */
function completedRound(correctCount: number): Partial<DailyTrivia> {
  return {
    tracked: true,
    attempt: {
      correctCount,
      answeredCount: 5,
      completed: true,
      answers: Array.from({ length: 5 }, (_, i) => ({
        questionId: `q${i + 1}`,
        selectedIndex: i < correctCount ? 0 : 2,
        isCorrect: i < correctCount,
        correctIndex: 0,
      })),
    },
  };
}

async function mockShell() {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getMyLeagues).mockResolvedValue([]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
}

/** Answers the currently-visible question, then dismisses the reveal. */
async function answerAndAdvance(user: ReturnType<typeof userEvent.setup>, college: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(college) }));
  const next = await screen.findByRole("button", { name: /next player|see your result/i });
  await user.click(next);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  resetGuestAttemptForTests();
  localStorage.clear();
  await mockShell();
});

describe("CollegeQuizScreen — playing logged out", () => {
  it("shows the first player, the prompt, and five colleges", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText("Player 1")).toBeInTheDocument();
    expect(screen.getByText(/which college did he attend/i)).toBeInTheDocument();
    for (const college of COLLEGES) {
      expect(screen.getByRole("button", { name: new RegExp(college) })).toBeInTheDocument();
    }
    expect(screen.getByText(/question 1 of 5/i)).toBeInTheDocument();
  });

  it("tells a guest up front that their streak isn't being tracked", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily({ tracked: false }));

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText(/playing as a guest/i)).toBeInTheDocument();
  });

  it("reveals the right answer after a wrong guess, and doesn't advance until Next", async () => {
    const user = userEvent.setup();
    const { getDailyTrivia, answerDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());
    vi.mocked(answerDailyTrivia).mockImplementation(async ({ questionId, selectedIndex }) =>
      graded(questionId, selectedIndex),
    );

    await renderRouteAt("/college-quiz");
    await user.click(await screen.findByRole("button", { name: /LSU/ }));

    expect(await screen.findByText(/Player 1 went to Alabama/i)).toBeInTheDocument();
    // Still on question 1 — the reveal is not skipped past.
    expect(screen.getByText(/question 1 of 5/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next player/i }));
    expect(await screen.findByText("Player 2")).toBeInTheDocument();
  });

  it("confirms a correct guess", async () => {
    const user = userEvent.setup();
    const { getDailyTrivia, answerDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());
    vi.mocked(answerDailyTrivia).mockImplementation(async ({ questionId, selectedIndex }) =>
      graded(questionId, selectedIndex),
    );

    await renderRouteAt("/college-quiz");
    await user.click(await screen.findByRole("button", { name: /Alabama/ }));

    expect(await screen.findByText("Correct!")).toBeInTheDocument();
  });

  it("plays all five back to back and lands on a shareable result", async () => {
    const user = userEvent.setup();
    const { getDailyTrivia, answerDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());
    vi.mocked(answerDailyTrivia).mockImplementation(async ({ questionId, selectedIndex }) =>
      graded(questionId, selectedIndex),
    );

    await renderRouteAt("/college-quiz");

    // Three right, two wrong.
    await answerAndAdvance(user, "Alabama");
    await answerAndAdvance(user, "Alabama");
    await answerAndAdvance(user, "Alabama");
    await answerAndAdvance(user, "LSU");
    await answerAndAdvance(user, "LSU");

    expect(await screen.findByText("3/5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share result|copy result/i })).toBeInTheDocument();
    // A guest is invited to sign up rather than shown a streak they
    // don't have.
    expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
  });

  it("resumes a half-finished guest round after a reload instead of restarting it", async () => {
    const user = userEvent.setup();
    const { getDailyTrivia, answerDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());
    vi.mocked(answerDailyTrivia).mockImplementation(async ({ questionId, selectedIndex }) =>
      graded(questionId, selectedIndex),
    );

    const first = await renderRouteAt("/college-quiz");
    await answerAndAdvance(user, "Alabama");
    await answerAndAdvance(user, "LSU");
    expect(await screen.findByText("Player 3")).toBeInTheDocument();
    first.history.destroy();

    // Simulate a reload: a brand-new render reading the same
    // localStorage the first round wrote to.
    await renderRouteAt("/college-quiz");

    expect(await screen.findAllByText("Player 3")).not.toHaveLength(0);
  });
});

describe("CollegeQuizScreen — playing logged in", () => {
  beforeEach(() => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
  });

  it("resumes from the SERVER's attempt, not localStorage", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(
      daily({
        tracked: true,
        attempt: {
          correctCount: 2,
          answeredCount: 2,
          completed: false,
          answers: [
            { questionId: "q1", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
            { questionId: "q2", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
          ],
        },
      }),
    );

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText("Player 3")).toBeInTheDocument();
    expect(screen.getByText(/question 3 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/2 correct/i)).toBeInTheDocument();
  });

  it("does not show the guest warning", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily({ tracked: true }));

    await renderRouteAt("/college-quiz");

    await screen.findByText("Player 1");
    expect(screen.queryByText(/playing as a guest/i)).not.toBeInTheDocument();
  });

  it("goes straight to the result for an already-completed round — no replay", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(
      daily({
        tracked: true,
        attempt: {
          correctCount: 4,
          answeredCount: 5,
          completed: true,
          answers: [
            { questionId: "q1", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
            { questionId: "q2", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
            { questionId: "q3", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
            { questionId: "q4", selectedIndex: 2, isCorrect: false, correctIndex: 0 },
            { questionId: "q5", selectedIndex: 0, isCorrect: true, correctIndex: 0 },
          ],
        },
      }),
    );

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText("4/5")).toBeInTheDocument();
    expect(screen.queryByText(/which college did he attend/i)).not.toBeInTheDocument();
  });
});

describe("CollegeQuizScreen — the result sharpens as the score drops", () => {
  it.each([
    [5, /perfect round/i],
    [4, /so close/i],
    [3, /you'll take it/i],
    [2, /rough day/i],
    [1, /yikes/i],
    [0, /total shutout/i],
  ])("gives %i/5 its own verdict", async (correctCount, headline) => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily(completedRound(correctCount)));

    await renderRouteAt("/college-quiz");

    expect(await screen.findByRole("heading", { name: headline })).toBeInTheDocument();
  });

  it("heckles a shutout instead of consoling it", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily(completedRound(0)));

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText(/blind guessing would have beaten you/i)).toBeInTheDocument();
  });

  it("is the ONE outcome that gets a compliment", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily(completedRound(5)));

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText(/nothing to teach you/i)).toBeInTheDocument();
  });
});

describe("CollegeQuizScreen — unhappy paths", () => {
  it("says the quiz isn't ready when the player pool hasn't been ingested", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockRejectedValue(
      new ApiError({ code: "TRIVIA_UNAVAILABLE", message: "The NFL player pool hasn't been loaded yet" }, 503),
    );

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText(/no quiz today/i)).toBeInTheDocument();
    // No Retry button — retrying genuinely cannot fix this.
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("says the same thing when the pool has too few distinct colleges", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockRejectedValue(
      new ApiError({ code: "TRIVIA_POOL_TOO_SMALL", message: "Not enough distinct colleges" }, 503),
    );

    await renderRouteAt("/college-quiz");

    // Same screen as TRIVIA_UNAVAILABLE: the two 503s differ only in
    // what an operator has to go fix.
    expect(await screen.findByText(/no quiz today/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry for an ordinary failure", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockRejectedValue(new ApiError({ code: "INTERNAL_ERROR", message: "boom" }, 500));

    await renderRouteAt("/college-quiz");

    expect(await screen.findByText(/couldn't load today's quiz/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("surfaces a failed answer submission without losing the round", async () => {
    const user = userEvent.setup();
    const { getDailyTrivia, answerDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());
    vi.mocked(answerDailyTrivia).mockRejectedValue(new ApiError({ code: "INTERNAL_ERROR", message: "boom" }, 500));

    await renderRouteAt("/college-quiz");
    await user.click(await screen.findByRole("button", { name: /Alabama/ }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // Still on question 1, still answerable.
    expect(screen.getByText(/question 1 of 5/i)).toBeInTheDocument();
  });
});

describe("CollegeQuizScreen — accessibility", () => {
  it("has no axe violations mid-round", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(daily());

    await renderRouteAt("/college-quiz");
    await screen.findByText("Player 1");

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("has no axe violations on the result card", async () => {
    const { getDailyTrivia } = await import("../../api/endpoints.js");
    vi.mocked(getDailyTrivia).mockResolvedValue(
      daily({
        tracked: true,
        attempt: {
          correctCount: 5,
          answeredCount: 5,
          completed: true,
          answers: Array.from({ length: 5 }, (_, i) => ({
            questionId: `q${i + 1}`,
            selectedIndex: 0,
            isCorrect: true,
            correctIndex: 0,
          })),
        },
      }),
    );

    await renderRouteAt("/college-quiz");
    await screen.findByText("5/5");

    await waitFor(async () => {
      expect(await axe(document.body)).toHaveNoViolations();
    });
  });
});
