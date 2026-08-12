import { beforeEach, describe, expect, it } from "vitest";
import { createTestGame, truncateAllTables } from "../db/test-helpers.js";
import { findStaleGames } from "./game-staleness.js";

beforeEach(async () => {
  await truncateAllTables();
});

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("findStaleGames", () => {
  it("does not flag a game that started well within its sport's max duration", async () => {
    const g = await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(2) });
    const stale = await findStaleGames();
    expect(stale.map((s) => s.id)).not.toContain(g.id);
  });

  it("flags an in_progress game well past its sport's max duration", async () => {
    const g = await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(6) });
    const stale = await findStaleGames();
    expect(stale.map((s) => s.id)).toContain(g.id);
  });

  it("flags a scheduled game whose start passed long ago and never moved to in_progress", async () => {
    const g = await createTestGame({ sport: "mlb", status: "scheduled", startsAt: hoursAgo(10) });
    const stale = await findStaleGames();
    expect(stale.map((s) => s.id)).toContain(g.id);
  });

  it("does not flag a scheduled game whose start is in the future", async () => {
    const g = await createTestGame({ sport: "nba", status: "scheduled", startsAt: hoursAgo(-2) });
    const stale = await findStaleGames();
    expect(stale.map((s) => s.id)).not.toContain(g.id);
  });

  it("never flags a final game, no matter how long ago it started", async () => {
    const g = await createTestGame({ sport: "nfl", status: "final", startsAt: hoursAgo(100) });
    const stale = await findStaleGames();
    expect(stale.map((s) => s.id)).not.toContain(g.id);
  });

  it("never flags a postponed or canceled game", async () => {
    const postponed = await createTestGame({ sport: "mlb", status: "postponed", startsAt: hoursAgo(50) });
    const canceled = await createTestGame({ sport: "mlb", status: "canceled", startsAt: hoursAgo(50) });
    const stale = await findStaleGames();
    const ids = stale.map((s) => s.id);
    expect(ids).not.toContain(postponed.id);
    expect(ids).not.toContain(canceled.id);
  });

  it("respects per-sport thresholds — a soccer game is stale sooner than an NFL game at the same elapsed time", async () => {
    const soccer = await createTestGame({ sport: "epl", status: "in_progress", startsAt: hoursAgo(3) });
    const nfl = await createTestGame({ sport: "nfl", status: "in_progress", startsAt: hoursAgo(3) });
    const stale = await findStaleGames();
    const ids = stale.map((s) => s.id);
    expect(ids).toContain(soccer.id); // 3h > epl's 2.5h threshold
    expect(ids).not.toContain(nfl.id); // 3h < nfl's 4.5h threshold
  });
});
