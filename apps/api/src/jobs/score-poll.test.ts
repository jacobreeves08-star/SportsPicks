import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { game, jobRun, pick, result, resultCorrection } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import * as errorTracking from "../lib/error-tracking.js";
import { MockSportsProvider, type CanonicalResult } from "../lib/sports-provider.js";
import { runScorePoll } from "./score-poll.js";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await truncateAllTables();
});

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("runScorePoll — exactly-once finalization", () => {
  it("finalizes a game and writes exactly one result row", async () => {
    const testGame = await createTestGame({
      externalId: "espn-1",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const canonical: CanonicalResult = { externalId: "espn-1", status: "final", winnerSide: "home" };
    const provider = new MockSportsProvider({ results: [canonical] });

    await runScorePoll(provider);

    const [gameRow] = await db.select().from(game).where(eq(game.id, testGame.id));
    expect(gameRow!.status).toBe("final");

    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.winningTeam).toBe("Bills");
    expect(resultRows[0]!.source).toBe("espn");
  });

  it("running twice against the same final result produces no duplicate and no revision bump", async () => {
    const testGame = await createTestGame({
      externalId: "espn-2",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-2", status: "final", winnerSide: "away" }],
    });

    await runScorePoll(provider);
    await runScorePoll(provider);

    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.revisionCount).toBe(0);
    expect(resultRows[0]!.winningTeam).toBe("Jets");
  });

  it("a draw writes the 'DRAW' sentinel as winning_team", async () => {
    const testGame = await createTestGame({
      externalId: "espn-3",
      sport: "epl",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      allowsDraw: true,
      status: "in_progress",
      startsAt: hoursAgo(2),
    });
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-3", status: "final", winnerSide: "draw" }],
    });

    await runScorePoll(provider);

    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows[0]!.winningTeam).toBe("DRAW");
  });

  it("does not finalize a game that's already final, even if the provider says final again (idempotent re-poll)", async () => {
    const testGame = await createTestGame({
      externalId: "espn-4",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "final",
      startsAt: hoursAgo(300),
    });
    // Outside the revision-detection window (JAC-40) on purpose — this
    // test is scoped to the MAIN finalization loop's idempotency, not
    // revision detection (covered separately below); a result inside
    // the window differing from the provider is legitimately supposed
    // to be picked up as a revision, not ignored.
    await db.insert(result).values({
      gameId: testGame.id,
      winningTeam: "Bills",
      source: "espn",
      createdAt: hoursAgo(300),
    });

    // Already-final games aren't in score-poll's own candidate query
    // (status in scheduled/in_progress only), so this also proves the
    // candidate filter itself keeps a final game out of consideration.
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-4", status: "final", winnerSide: "away" }],
    });
    await runScorePoll(provider);

    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.winningTeam).toBe("Bills"); // unchanged
    expect(resultRows[0]!.revisionCount).toBe(0);
  });
});

describe("runScorePoll — candidate selection", () => {
  it("only polls games whose start has passed and status isn't final", async () => {
    await createTestGame({ externalId: "future", status: "scheduled", startsAt: hoursAgo(-3) }); // starts in the future
    await createTestGame({ externalId: "already-final", status: "final", startsAt: hoursAgo(5) });
    const started = await createTestGame({
      externalId: "started",
      status: "in_progress",
      startsAt: hoursAgo(1),
      homeTeam: "Home",
      awayTeam: "Away",
    });

    const provider = new MockSportsProvider({
      results: [
        { externalId: "future", status: "final", winnerSide: "home" },
        { externalId: "already-final", status: "final", winnerSide: "home" },
        { externalId: "started", status: "final", winnerSide: "home" },
      ],
    });

    await runScorePoll(provider);

    // Only "started" should have been touched — the other two were
    // never even candidates for a fetchResults call.
    const resultRows = await db.select().from(result);
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]!.gameId).toBe(started.id);
  });

  it("never treats an in-progress (not completed) result as final, no matter what it looks like", async () => {
    const testGame = await createTestGame({
      externalId: "espn-5",
      status: "in_progress",
      startsAt: hoursAgo(1),
    });
    // Simulates the adapter's own guarantee: a lopsided-but-not-final
    // game is reported as in_progress, never final, at the canonical
    // layer already — score-poll must respect that status as given.
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-5", status: "in_progress", winnerSide: null }],
    });

    await runScorePoll(provider);

    const [gameRow] = await db.select().from(game).where(eq(game.id, testGame.id));
    expect(gameRow!.status).toBe("in_progress");
    const resultRows = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRows).toHaveLength(0);
  });

  it("postponed and canceled candidates get their status updated but never a result row", async () => {
    const postponedGame = await createTestGame({ externalId: "espn-postponed", status: "in_progress", startsAt: hoursAgo(1) });
    const canceledGame = await createTestGame({ externalId: "espn-canceled", status: "in_progress", startsAt: hoursAgo(1) });

    const provider = new MockSportsProvider({
      results: [
        { externalId: "espn-postponed", status: "postponed", winnerSide: null },
        { externalId: "espn-canceled", status: "canceled", winnerSide: null },
      ],
    });

    await runScorePoll(provider);

    const [postponedRow] = await db.select().from(game).where(eq(game.id, postponedGame.id));
    const [canceledRow] = await db.select().from(game).where(eq(game.id, canceledGame.id));
    expect(postponedRow!.status).toBe("postponed");
    expect(canceledRow!.status).toBe("canceled");

    const resultRows = await db.select().from(result);
    expect(resultRows).toHaveLength(0);
  });
});

describe("runScorePoll — staleness alerting", () => {
  it("reports stale games via captureMessage without failing the run", async () => {
    await createTestGame({ externalId: "stale-1", sport: "nfl", status: "in_progress", startsAt: hoursAgo(10) });
    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");

    const provider = new MockSportsProvider({ results: [] });
    await runScorePoll(provider);

    expect(captureMessageSpy).toHaveBeenCalledWith(expect.stringContaining("past expected end"), expect.anything());

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "score-poll"));
    expect(run!.succeeded).toBe(true);
  });

  it("does not alert when nothing is stale", async () => {
    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");
    const provider = new MockSportsProvider({ results: [] });
    await runScorePoll(provider);
    expect(captureMessageSpy).not.toHaveBeenCalled();
  });
});

describe("runScorePoll — job_run tracking", () => {
  it("records a successful empty run when there are no candidates", async () => {
    const provider = new MockSportsProvider({ results: [] });
    await runScorePoll(provider);
    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "score-poll"));
    expect(run!.succeeded).toBe(true);
    expect(run!.itemCount).toBe(0);
  });

  it("records a failed run and rethrows when the provider throws", async () => {
    await createTestGame({ externalId: "espn-err", status: "in_progress", startsAt: hoursAgo(1) });
    const provider = {
      fetchSchedule: async () => [],
      fetchResults: async () => {
        throw new Error("ESPN unreachable");
      },
    };

    await expect(runScorePoll(provider)).rejects.toThrow("ESPN unreachable");

    const [run] = await db.select().from(jobRun).where(eq(jobRun.jobName, "score-poll"));
    expect(run!.succeeded).toBe(false);
    expect(run!.errorMessage).toContain("ESPN unreachable");
  });
});

/**
 * Grading integration (JAC-37-42) — score-poll is where a game's
 * final-transition and postponed/cancelled-transition both happen, so
 * it's also where grading/voiding must happen in the SAME transaction.
 * See lib/grading.test.ts for the grading functions' own isolated
 * tests; these confirm the JOB actually calls them.
 */
describe("runScorePoll — grading integration", () => {
  it("grades a pick win/loss in the same run that finalizes the game", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const memberWin = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const other = await createTestUser();
    const memberLoss = await createTestLeagueMember(other.id, league.id, { role: "member" });

    const testGame = await createTestGame({
      externalId: "espn-grade-1",
      sport: "nfl",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const pickWin = await createTestPick(memberWin.id, testGame.id, { selectedTeam: "Bills" });
    const pickLoss = await createTestPick(memberLoss.id, testGame.id, { selectedTeam: "Jets" });

    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-grade-1", status: "final", winnerSide: "home" }],
    });
    await runScorePoll(provider);

    const [winRow] = await db.select().from(pick).where(eq(pick.id, pickWin.id));
    const [lossRow] = await db.select().from(pick).where(eq(pick.id, pickLoss.id));
    expect(winRow!.outcome).toBe("win");
    expect(lossRow!.outcome).toBe("loss");
  });

  it("voids picks in the same run that a game transitions to postponed", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({
      externalId: "espn-grade-postponed",
      sport: "nfl",
      status: "in_progress",
      startsAt: hoursAgo(1),
    });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Home" });

    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-grade-postponed", status: "postponed", winnerSide: null }],
    });
    await runScorePoll(provider);

    const [pickRow] = await db.select().from(pick).where(eq(pick.id, testPick.id));
    expect(pickRow!.outcome).toBe("void");
  });

  it("reconciliation sweep voids ungraded picks on a postponed/cancelled game score-poll itself can no longer see (self-healing)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    // Directly cancelled at the DB level, simulating a transition whose
    // own void call was somehow missed — score-poll's own candidate
    // query excludes this game entirely (status not in
    // scheduled/in_progress), so ONLY the reconciliation sweep can
    // reach it.
    const testGame = await createTestGame({
      externalId: "espn-orphaned",
      status: "canceled",
      startsAt: hoursAgo(5),
    });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Home" });

    const provider = new MockSportsProvider({ results: [] });
    await runScorePoll(provider);

    const [pickRow] = await db.select().from(pick).where(eq(pick.id, testPick.id));
    expect(pickRow!.outcome).toBe("void");
  });
});

/**
 * The literal JAC-37 required verification: "Verify against a seeded
 * league with a hand-calculated expected record." Three members, five
 * games mixing wins, losses, a postponed void, and members who simply
 * didn't pick a given game — graded through the real runScorePoll
 * pipeline, not by calling grading.ts functions directly, then checked
 * against a record computed by hand below.
 *
 * Hand-calculated expected record:
 *   Alice: Bills(W), Chiefs(W), Packers(L), Eagles(void), 49ers(W)
 *          -> 3 wins, 1 loss, 1 void -> gamesParticipated 4, win% 75%
 *   Bob:   Jets(L), Chiefs(W), Bears(W), Giants(void), no pick on game 5
 *          -> 2 wins, 1 loss, 1 void, 1 no-pick -> gamesParticipated 3, win% 66.67%
 *   Carol: no pick on game 1, Raiders(L), Bears(W), no pick on game 4, Rams(L)
 *          -> 1 win, 2 losses -> gamesParticipated 3, win% 33.33%
 */
describe("runScorePoll — seeded-league hand-calculated verification (JAC-37)", () => {
  it("grades a mixed slate to exactly the hand-calculated record", async () => {
    const aliceUser = await createTestUser({ displayName: "Alice" });
    const bobUser = await createTestUser({ displayName: "Bob" });
    const carolUser = await createTestUser({ displayName: "Carol" });
    const league = await createTestLeague(aliceUser.id);
    const alice = await createTestLeagueMember(aliceUser.id, league.id, { role: "commissioner" });
    const bob = await createTestLeagueMember(bobUser.id, league.id, { role: "member" });
    const carol = await createTestLeagueMember(carolUser.id, league.id, { role: "member" });

    const game1 = await createTestGame({
      externalId: "seed-1",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const game2 = await createTestGame({
      externalId: "seed-2",
      homeTeam: "Chiefs",
      awayTeam: "Raiders",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const game3 = await createTestGame({
      externalId: "seed-3",
      homeTeam: "Packers",
      awayTeam: "Bears",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const game4 = await createTestGame({
      externalId: "seed-4",
      homeTeam: "Eagles",
      awayTeam: "Giants",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });
    const game5 = await createTestGame({
      externalId: "seed-5",
      homeTeam: "49ers",
      awayTeam: "Rams",
      status: "in_progress",
      startsAt: hoursAgo(3),
    });

    await createTestPick(alice.id, game1.id, { selectedTeam: "Bills" });
    await createTestPick(bob.id, game1.id, { selectedTeam: "Jets" });
    // Carol: no pick on game1.

    await createTestPick(alice.id, game2.id, { selectedTeam: "Chiefs" });
    await createTestPick(bob.id, game2.id, { selectedTeam: "Chiefs" });
    await createTestPick(carol.id, game2.id, { selectedTeam: "Raiders" });

    await createTestPick(alice.id, game3.id, { selectedTeam: "Packers" });
    await createTestPick(bob.id, game3.id, { selectedTeam: "Bears" });
    await createTestPick(carol.id, game3.id, { selectedTeam: "Bears" });

    await createTestPick(alice.id, game4.id, { selectedTeam: "Eagles" });
    await createTestPick(bob.id, game4.id, { selectedTeam: "Giants" });
    // Carol: no pick on game4 (which will be postponed).

    await createTestPick(alice.id, game5.id, { selectedTeam: "49ers" });
    // Bob: no pick on game5.
    await createTestPick(carol.id, game5.id, { selectedTeam: "Rams" });

    const provider = new MockSportsProvider({
      results: [
        { externalId: "seed-1", status: "final", winnerSide: "home" }, // Bills
        { externalId: "seed-2", status: "final", winnerSide: "home" }, // Chiefs
        { externalId: "seed-3", status: "final", winnerSide: "away" }, // Bears
        { externalId: "seed-4", status: "postponed", winnerSide: null },
        { externalId: "seed-5", status: "final", winnerSide: "home" }, // 49ers
      ],
    });
    await runScorePoll(provider);

    async function recordFor(memberId: string) {
      const rows = await db.select({ outcome: pick.outcome }).from(pick).where(eq(pick.leagueMemberId, memberId));
      return {
        wins: rows.filter((r) => r.outcome === "win").length,
        losses: rows.filter((r) => r.outcome === "loss").length,
        voids: rows.filter((r) => r.outcome === "void").length,
        totalPicks: rows.length,
      };
    }

    const aliceRecord = await recordFor(alice.id);
    expect(aliceRecord).toEqual({ wins: 3, losses: 1, voids: 1, totalPicks: 5 });

    const bobRecord = await recordFor(bob.id);
    expect(bobRecord).toEqual({ wins: 2, losses: 1, voids: 1, totalPicks: 4 });

    const carolRecord = await recordFor(carol.id);
    expect(carolRecord).toEqual({ wins: 1, losses: 2, voids: 0, totalPicks: 3 });

    // Win% (games-participated = wins + losses, void and no-pick excluded).
    expect(aliceRecord.wins / (aliceRecord.wins + aliceRecord.losses)).toBeCloseTo(0.75, 5);
    expect(bobRecord.wins / (bobRecord.wins + bobRecord.losses)).toBeCloseTo(0.6667, 3);
    expect(carolRecord.wins / (carolRecord.wins + carolRecord.losses)).toBeCloseTo(0.3333, 3);
  });
});

describe("runScorePoll — automatic revision detection (JAC-40)", () => {
  it("regrades and records a correction when the provider revises a recently-final result", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const memberWin = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const other = await createTestUser();
    const memberLoss = await createTestLeagueMember(other.id, league.id, { role: "member" });

    const testGame = await createTestGame({
      externalId: "espn-revision-1",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "final",
      startsAt: hoursAgo(10),
    });
    // Finalized recently — inside the default 48h revision window.
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "espn" });
    const pickBills = await createTestPick(memberWin.id, testGame.id, { selectedTeam: "Bills" });
    const pickJets = await createTestPick(memberLoss.id, testGame.id, { selectedTeam: "Jets" });
    await db.update(pick).set({ outcome: "win", gradedAt: new Date() }).where(eq(pick.id, pickBills.id));
    await db.update(pick).set({ outcome: "loss", gradedAt: new Date() }).where(eq(pick.id, pickJets.id));

    const captureMessageSpy = vi.spyOn(errorTracking, "captureMessage");
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-revision-1", status: "final", winnerSide: "away" }], // now Jets
    });
    await runScorePoll(provider);

    const [resultRow] = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRow!.winningTeam).toBe("Jets");
    expect(resultRow!.revisionCount).toBe(1); // bump_result_revision trigger

    const [billsPickRow] = await db.select().from(pick).where(eq(pick.id, pickBills.id));
    const [jetsPickRow] = await db.select().from(pick).where(eq(pick.id, pickJets.id));
    expect(billsPickRow!.outcome).toBe("loss"); // flipped
    expect(jetsPickRow!.outcome).toBe("win"); // flipped

    const [correctionRow] = await db.select().from(resultCorrection).where(eq(resultCorrection.gameId, testGame.id));
    expect(correctionRow).toMatchObject({
      oldWinningTeam: "Bills",
      newWinningTeam: "Jets",
      source: "provider_revision",
    });

    expect(captureMessageSpy).toHaveBeenCalledWith(
      "score-poll: provider revised a previously-final result",
      expect.objectContaining({ gameId: testGame.id }),
    );
  });

  it("does nothing when the provider's result still matches the stored one", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({
      externalId: "espn-no-revision",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "final",
      startsAt: hoursAgo(10),
    });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "espn" });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Bills" });
    await db.update(pick).set({ outcome: "win", gradedAt: new Date() }).where(eq(pick.id, testPick.id));

    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-no-revision", status: "final", winnerSide: "home" }], // still Bills
    });
    await runScorePoll(provider);

    const [resultRow] = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRow!.revisionCount).toBe(0);
    const corrections = await db.select().from(resultCorrection).where(eq(resultCorrection.gameId, testGame.id));
    expect(corrections).toHaveLength(0);
  });

  it("does not re-check a game that finalized outside the revision window", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const testGame = await createTestGame({
      externalId: "espn-old-final",
      homeTeam: "Bills",
      awayTeam: "Jets",
      status: "final",
      startsAt: hoursAgo(200),
    });
    // Finalized 100 hours ago — outside the default 48h revision window.
    await db.insert(result).values({
      gameId: testGame.id,
      winningTeam: "Bills",
      source: "espn",
      createdAt: hoursAgo(100),
    });
    const testPick = await createTestPick(member.id, testGame.id, { selectedTeam: "Bills" });
    await db.update(pick).set({ outcome: "win", gradedAt: hoursAgo(100) }).where(eq(pick.id, testPick.id));

    // The provider WOULD report a different winner if asked — proves
    // the candidate query itself excludes this game, not that the
    // provider happened to agree.
    const provider = new MockSportsProvider({
      results: [{ externalId: "espn-old-final", status: "final", winnerSide: "away" }],
    });
    await runScorePoll(provider);

    const [resultRow] = await db.select().from(result).where(eq(result.gameId, testGame.id));
    expect(resultRow!.winningTeam).toBe("Bills"); // untouched
    expect(resultRow!.revisionCount).toBe(0);
  });
});
