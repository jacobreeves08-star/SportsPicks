import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { game, jobRun, result } from "../db/schema.js";
import { createTestGame, truncateAllTables } from "../db/test-helpers.js";
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
      startsAt: hoursAgo(5),
    });
    await db.insert(result).values({ gameId: testGame.id, winningTeam: "Bills", source: "espn" });

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
