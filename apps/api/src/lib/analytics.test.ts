import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/client.js";
import { analyticsEvent } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPickAuditLog,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import { computeSlateCompletionRate, logEvent } from "./analytics.js";

beforeEach(async () => {
  await truncateAllTables();
});

// Fixed to explicit hours within "today" (UTC) rather than relative
// hoursFromNow offsets — a relative offset could cross into tomorrow
// depending on wall-clock time when the suite runs, breaking
// dayBoundsUtc's day window. Mirrors jobs/results-summary.test.ts.
const today = DateTime.now().setZone("UTC").toISODate()!;

function todayAt(hour: number): Date {
  return DateTime.fromISO(today, { zone: "UTC" }).set({ hour }).toJSDate();
}

describe("logEvent", () => {
  it("inserts a row with every field set", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    const member = await createTestLeagueMember(owner.id, league.id);

    await logEvent("league_created", {
      userId: owner.id,
      leagueId: league.id,
      leagueMemberId: member.id,
      metadata: { foo: "bar" },
    });

    const rows = await db.select().from(analyticsEvent).where(eq(analyticsEvent.eventType, "league_created"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "league_created",
      userId: owner.id,
      leagueId: league.id,
      leagueMemberId: member.id,
      metadata: { foo: "bar" },
    });
  });

  it("inserts a row with nulls when no optional params are given", async () => {
    await logEvent("user_signed_up");

    const rows = await db.select().from(analyticsEvent).where(eq(analyticsEvent.eventType, "user_signed_up"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, leagueId: null, leagueMemberId: null, metadata: null });
  });
});

describe("computeSlateCompletionRate", () => {
  it("returns null rate for a league with no games today", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"] });
    await createTestLeagueMember(owner.id, league.id);

    const result = await computeSlateCompletionRate(league.id, today);

    expect(result).toEqual({ totalMembers: 0, completedCount: 0, rate: null });
  });

  it("returns null rate when the league has no active members", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    await createTestGame({ sport: "nfl", startsAt: todayAt(10) });

    const result = await computeSlateCompletionRate(league.id, today);

    expect(result).toEqual({ totalMembers: 0, completedCount: 0, rate: null });
  });

  it("hand-calculated: counts a member complete only if every game was picked before the first lock", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    const alice = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser();
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    // First lock is gameA's start (10am); gameB starts later (13:00).
    const gameA = await createTestGame({ sport: "nfl", startsAt: todayAt(10) });
    const gameB = await createTestGame({ sport: "nfl", startsAt: todayAt(13) });
    const firstLockAt = gameA.startsAt;

    // Alice: picked both games well before the first lock -> complete.
    await createTestPickAuditLog(alice.id, gameA.id, { createdAt: new Date(firstLockAt.getTime() - 60_000) });
    await createTestPickAuditLog(alice.id, gameB.id, { createdAt: new Date(firstLockAt.getTime() - 30_000) });

    // Bob: only picked gameA -> incomplete (missing gameB entirely).
    await createTestPickAuditLog(bob.id, gameA.id, { createdAt: new Date(firstLockAt.getTime() - 60_000) });

    const result = await computeSlateCompletionRate(league.id, today);

    expect(result).toEqual({ totalMembers: 2, completedCount: 1, rate: 0.5 });
  });

  it("regression: an early pick later edited after the first lock counts as late, not on-time", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    const alice = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const gameA = await createTestGame({ sport: "nfl", startsAt: todayAt(10) });
    const gameB = await createTestGame({ sport: "nfl", startsAt: todayAt(13) });
    const firstLockAt = gameA.startsAt;

    // gameA: picked well before the first lock.
    await createTestPickAuditLog(alice.id, gameA.id, { createdAt: new Date(firstLockAt.getTime() - 60_000) });
    // gameB: an EARLY original pick before the first lock, but then
    // edited AFTER it. If this read pick.created_at (the original
    // insert time, never touched by an edit) instead of
    // pick_audit_log's MAX(created_at), this would wrongly count as
    // on-time — the whole point of this test.
    await createTestPickAuditLog(alice.id, gameB.id, {
      action: "create",
      createdAt: new Date(firstLockAt.getTime() - 120_000),
    });
    await createTestPickAuditLog(alice.id, gameB.id, {
      action: "change",
      createdAt: new Date(firstLockAt.getTime() + 60_000),
    });

    const result = await computeSlateCompletionRate(league.id, today);

    expect(result).toEqual({ totalMembers: 1, completedCount: 0, rate: 0 });
  });

  it("excludes postponed and canceled games from the completion requirement", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { sports: ["nfl"], timezone: "UTC" });
    const alice = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });

    const realGame = await createTestGame({ sport: "nfl", startsAt: todayAt(10) });
    await createTestGame({ sport: "nfl", startsAt: todayAt(11), status: "postponed" });
    const firstLockAt = realGame.startsAt;

    // Only picks the one real, non-postponed game.
    await createTestPickAuditLog(alice.id, realGame.id, { createdAt: new Date(firstLockAt.getTime() - 60_000) });

    const result = await computeSlateCompletionRate(league.id, today);

    expect(result).toEqual({ totalMembers: 1, completedCount: 1, rate: 1 });
  });
});
