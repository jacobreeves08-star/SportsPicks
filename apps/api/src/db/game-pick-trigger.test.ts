import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./client.js";
import { game, pick } from "./schema.js";
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

/**
 * JAC-37-42, 0007_pick_trigger_column_scope.sql: the trigger used to be
 * `before insert or update on pick` with no column qualifier, so it
 * re-validated selected_team against game.home_team/away_team on EVERY
 * update — including grading's `set outcome = ...`, which never
 * touches selected_team. Discovered live: a team-name correction on
 * re-ingest (Epic 3's documented, deliberate name-drift correction)
 * landing on a game AFTER a pick was already made against the OLD name
 * made grading that pick crash outright.
 */
describe("check_pick_selected_team trigger — column scope (JAC-37-42 regression)", () => {
  it("an unrelated column update (e.g. grading) does not re-validate selected_team, even if the game's team names changed since the pick was made", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Home", awayTeam: "Away" });
    const [testPick] = await db
      .insert(pick)
      .values({ leagueMemberId: member.id, gameId: testGame.id, selectedTeam: "Home" })
      .returning();

    // A team-name correction lands on the game AFTER the pick was made
    // — "Home" is no longer a participant name at all.
    await db.update(game).set({ homeTeam: "Home Team", awayTeam: "Away Team" }).where(eq(game.id, testGame.id));

    // Grading only ever touches outcome/graded_at — must not re-trigger
    // participant validation against the now-stale selected_team.
    await expect(
      db.update(pick).set({ outcome: "win", gradedAt: new Date() }).where(eq(pick.id, testPick!.id)),
    ).resolves.not.toThrow();
  });

  it("still validates on INSERT", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });

    await expect(
      db.insert(pick).values({ leagueMemberId: member.id, gameId: testGame.id, selectedTeam: "Cowboys" }),
    ).rejects.toThrow();
  });

  it("still validates when selected_team ITSELF is the column being changed (a real pick change, not a grading write)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);
    const testGame = await createTestGame({ sport: "nfl", homeTeam: "Bills", awayTeam: "Jets" });
    const [testPick] = await db
      .insert(pick)
      .values({ leagueMemberId: member.id, gameId: testGame.id, selectedTeam: "Bills" })
      .returning();

    await expect(
      db.update(pick).set({ selectedTeam: "Cowboys" }).where(eq(pick.id, testPick!.id)),
    ).rejects.toThrow();
  });
});
