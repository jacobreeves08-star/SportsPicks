import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { game as gameTable, pick } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { gradeFinalGame, regradeGame, voidGamePicks, voidGamePicksForGames } from "./grading.js";

beforeEach(async () => {
  await truncateAllTables();
});

async function setupPick(selectedTeam: string, overrides: Parameters<typeof createTestPick>[2] = {}) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id);
  const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
  const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
  const p = await createTestPick(member.id, game.id, { selectedTeam, ...overrides });
  return { owner, league, member, game, pick: p };
}

async function outcomeOf(pickId: string) {
  const [row] = await db.select().from(pick).where(eq(pick.id, pickId));
  return { outcome: row!.outcome, gradedAt: row!.gradedAt };
}

describe("gradeFinalGame", () => {
  it("grades a correct pick as a win", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await gradeFinalGame(game.id, "Bills", db);
    const { outcome, gradedAt } = await outcomeOf(p.id);
    expect(outcome).toBe("win");
    expect(gradedAt).not.toBeNull();
  });

  it("grades an incorrect pick as a loss", async () => {
    const { game, pick: p } = await setupPick("Jets");
    await gradeFinalGame(game.id, "Bills", db);
    const { outcome } = await outcomeOf(p.id);
    expect(outcome).toBe("loss");
  });

  it("is idempotent — grading twice does not change or double-count anything", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await gradeFinalGame(game.id, "Bills", db);
    const first = await outcomeOf(p.id);

    // A second call, even with a DIFFERENT (wrong) winning team, must
    // be a no-op — the outcome-is-null guard means it matches zero rows.
    await gradeFinalGame(game.id, "Jets", db);
    const second = await outcomeOf(p.id);

    expect(second.outcome).toBe("win"); // unchanged
    expect(second.gradedAt).toEqual(first.gradedAt); // untouched, not re-stamped
  });

  it("a member who never picked scores nothing — no row to grade, no error", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });

    await expect(gradeFinalGame(game.id, "Bills", db)).resolves.not.toThrow();
    const picks = await db.select().from(pick).where(eq(pick.gameId, game.id));
    expect(picks).toHaveLength(0);
  });
});

describe("voidGamePicks", () => {
  it("voids a pick rather than counting it as a loss", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await voidGamePicks(game.id, db);
    const { outcome } = await outcomeOf(p.id);
    expect(outcome).toBe("void");
  });

  it("is idempotent", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await voidGamePicks(game.id, db);
    const first = await outcomeOf(p.id);
    await voidGamePicks(game.id, db);
    const second = await outcomeOf(p.id);
    expect(second.gradedAt).toEqual(first.gradedAt);
  });
});

describe("regradeGame", () => {
  it("overwrites an already-graded win/loss outcome (unlike gradeFinalGame, no outcome-is-null guard)", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await gradeFinalGame(game.id, "Bills", db);
    expect((await outcomeOf(p.id)).outcome).toBe("win");

    // The provider revised the result: Jets actually won.
    await regradeGame(game.id, "Jets", db);
    const { outcome, gradedAt } = await outcomeOf(p.id);
    expect(outcome).toBe("loss");
    expect(gradedAt).not.toBeNull();
  });

  it("never un-voids a voided pick — void is terminal, unrelated to a result correction", async () => {
    const { game, pick: p } = await setupPick("Bills");
    await voidGamePicks(game.id, db);
    expect((await outcomeOf(p.id)).outcome).toBe("void");

    await regradeGame(game.id, "Bills", db);
    expect((await outcomeOf(p.id)).outcome).toBe("void"); // untouched
  });

  it("also grades a pick that was never graded at all (e.g. a correction on a game whose grading was somehow missed)", async () => {
    const { game, pick: p } = await setupPick("Bills");
    // Never called gradeFinalGame — outcome starts null.
    await regradeGame(game.id, "Bills", db);
    expect((await outcomeOf(p.id)).outcome).toBe("win");
  });
});

describe("grading multiple members on the same game — hand-verifiable scenario", () => {
  it("grades each member independently based on their own selection", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const memberA = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const other = await createTestUser();
    const memberB = await createTestLeagueMember(other.id, league.id, { role: "member" });
    const game = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets" });
    const pickA = await createTestPick(memberA.id, game.id, { selectedTeam: "Bills" });
    const pickB = await createTestPick(memberB.id, game.id, { selectedTeam: "Jets" });

    await gradeFinalGame(game.id, "Bills", db);

    expect((await outcomeOf(pickA.id)).outcome).toBe("win");
    expect((await outcomeOf(pickB.id)).outcome).toBe("loss");
  });
});

describe("voidGamePicksForGames", () => {
  it("voids ungraded picks only for games that are CURRENTLY postponed/cancelled among the given IDs", async () => {
    const { game: postponedGame, pick: postponedPick } = await setupPick("Bills", {});
    await db.update(gameTable).set({ status: "postponed" }).where(eq(gameTable.id, postponedGame.id));

    const { game: scheduledGame, pick: scheduledPick } = await setupPick("Bills", {});
    // scheduledGame stays 'scheduled' — should NOT be voided even
    // though its ID is included in the call.

    await voidGamePicksForGames([postponedGame.id, scheduledGame.id], db);

    expect((await outcomeOf(postponedPick.id)).outcome).toBe("void");
    expect((await outcomeOf(scheduledPick.id)).outcome).toBeNull();
  });

  it("is a no-op for an empty array", async () => {
    await expect(voidGamePicksForGames([], db)).resolves.not.toThrow();
  });

  it("is idempotent, same as the single-game version", async () => {
    const { game, pick: p } = await setupPick("Bills", {});
    await db.update(gameTable).set({ status: "canceled" }).where(eq(gameTable.id, game.id));

    await voidGamePicksForGames([game.id], db);
    const first = await outcomeOf(p.id);
    await voidGamePicksForGames([game.id], db);
    const second = await outcomeOf(p.id);

    expect(second.gradedAt).toEqual(first.gradedAt);
  });
});
