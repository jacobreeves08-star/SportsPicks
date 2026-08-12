import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./client.js";
import { pick } from "./schema.js";
import { createTestGame, createTestLeague, createTestLeagueMember, createTestUser, truncateAllTables } from "./test-helpers.js";

beforeEach(async () => {
  await truncateAllTables();
});

/** Drizzle wraps the real Postgres error (the trigger's RAISE EXCEPTION
 * message) in a generic "Failed query: ..." top-level message — the
 * actual detail is on `.cause`. */
async function insertRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = err instanceof Error ? (err.cause ?? err) : err;
    return String(cause instanceof Error ? cause.message : cause);
  }
  throw new Error("expected the insert to be rejected, but it succeeded");
}

/**
 * Isolates check_pick_selected_team's behavior by inserting directly
 * via db.insert(pick), bypassing the route layer entirely — the trigger
 * is the actual source of truth for this invariant, so it's tested
 * against directly rather than only indirectly through a route.
 */
describe("check_pick_selected_team trigger — draw support (JAC-20)", () => {
  it("accepts 'DRAW' for a game with allows_draw = true", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const game = await createTestGame({ sport: "epl", homeTeam: "Arsenal", awayTeam: "Chelsea", allowsDraw: true });

    await expect(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: game.id, selectedTeam: "DRAW" }),
    ).resolves.not.toThrow();
  });

  it("rejects 'DRAW' for a game with allows_draw = false", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const game = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets", allowsDraw: false });

    const message = await insertRejectionMessage(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: game.id, selectedTeam: "DRAW" }),
    );
    expect(message).toMatch(/DRAW is not allowed/);
  });

  it("still accepts a real participant team name for a draw-eligible game", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const game = await createTestGame({ sport: "epl", homeTeam: "Arsenal", awayTeam: "Chelsea", allowsDraw: true });

    await expect(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: game.id, selectedTeam: "Arsenal" }),
    ).resolves.not.toThrow();
  });

  it("regression: still rejects a team that isn't a participant, unrelated to draw support", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const game = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets", allowsDraw: false });

    const message = await insertRejectionMessage(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: game.id, selectedTeam: "Cowboys" }),
    );
    expect(message).toMatch(/is not a participant/);
  });

  it("regression: still accepts a real participant team name for a non-draw-eligible game", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const game = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets", allowsDraw: false });

    await expect(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: game.id, selectedTeam: "Bills" }),
    ).resolves.not.toThrow();
  });
});
