import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import { game as gameTable, pick, pickAuditLog } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { createSession } from "../lib/session.js";

/**
 * Tests for the new JAC-31-36 endpoints (batch pick write, slate,
 * audit trail) — kept in a separate file from leagues.routes.test.ts
 * purely for size; the routes themselves live in leagues.routes.ts
 * alongside the existing single-pick PUT route (whose own lock-
 * enforcement tests stay colocated there).
 */

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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

describe("POST /leagues/:leagueId/members/:memberId/picks/batch", () => {
  it("a batch of 5 where 2 have already started resolves to 3 accepted, 2 rejected, with per-game detail (JAC-33)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const open1 = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const open2 = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(60) });
    const open3 = await createTestGame({ homeTeam: "Packers", awayTeam: "Bears", startsAt: minutesFromNow(60) });
    const started1 = await createTestGame({ homeTeam: "Eagles", awayTeam: "Giants", startsAt: minutesFromNow(-5) });
    const started2 = await createTestGame({ homeTeam: "49ers", awayTeam: "Rams", startsAt: minutesFromNow(-10) });

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: open1.id, selectedTeam: "Bills" },
          { gameId: open2.id, selectedTeam: "Chiefs" },
          { gameId: started1.id, selectedTeam: "Eagles" },
          { gameId: open3.id, selectedTeam: "Packers" },
          { gameId: started2.id, selectedTeam: "49ers" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results).toHaveLength(5);

    const byGame = new Map(results.map((r: { gameId: string }) => [r.gameId, r]));
    expect(byGame.get(open1.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Bills" } });
    expect(byGame.get(open2.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Chiefs" } });
    expect(byGame.get(open3.id)).toMatchObject({ status: "accepted", pick: { selectedTeam: "Packers" } });
    expect(byGame.get(started1.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });
    expect(byGame.get(started2.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });

    const accepted = results.filter((r: { status: string }) => r.status === "accepted");
    const rejected = results.filter((r: { status: string }) => r.status === "rejected");
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    // The 3 accepted picks are actually persisted; the 2 rejected ones are not.
    const persistedPicks = await db.select().from(pick).where(eq(pick.leagueMemberId, member.id));
    expect(persistedPicks).toHaveLength(3);
  });

  it("a game moved EARLIER mid-batch-preparation, picked after the new start time, is rejected within the batch too", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const stillOpen = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const movedGame = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(60) });

    // Reschedule movedGame earlier, into the past, before the batch is submitted.
    await db.update(gameTable).set({ startsAt: minutesFromNow(-1) }).where(eq(gameTable.id, movedGame.id));

    const token = await tokenFor(owner.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: stillOpen.id, selectedTeam: "Bills" },
          { gameId: movedGame.id, selectedTeam: "Chiefs" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    const byGame = new Map(results.map((r: { gameId: string }) => [r.gameId, r]));
    expect(byGame.get(stillOpen.id)).toMatchObject({ status: "accepted" });
    expect(byGame.get(movedGame.id)).toMatchObject({ status: "rejected", error: { code: "PICK_LOCKED" } });
  });

  it("rejecting one game does not affect the audit log of accepted games in the same batch", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const member = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const open = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });
    const started = await createTestGame({ homeTeam: "Chiefs", awayTeam: "Raiders", startsAt: minutesFromNow(-5) });

    const token = await tokenFor(owner.id);
    await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${member.id}/picks/batch`,
      headers: auth(token),
      payload: {
        picks: [
          { gameId: open.id, selectedTeam: "Bills" },
          { gameId: started.id, selectedTeam: "Chiefs" },
        ],
      },
    });

    const auditRows = await db.select().from(pickAuditLog).where(eq(pickAuditLog.leagueMemberId, member.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.gameId).toBe(open.id);
    expect(auditRows[0]!.action).toBe("create");
  });

  it("a member cannot batch-write picks as another member — real 403 over HTTP", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestLeagueMember(userA.id, league.id, { role: "member" });
    const memberB = await createTestLeagueMember(userB.id, league.id, { role: "member" });
    const g = await createTestGame({ homeTeam: "Bills", awayTeam: "Jets", startsAt: minutesFromNow(60) });

    const tokenA = await tokenFor(userA.id);
    const res = await app.inject({
      method: "POST",
      url: `/leagues/${league.id}/members/${memberB.id}/picks/batch`,
      headers: auth(tokenA),
      payload: { picks: [{ gameId: g.id, selectedTeam: "Bills" }] },
    });

    expect(res.statusCode).toBe(403);
  });
});
