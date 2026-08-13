import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { notificationLog, pick } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import type { EmailProvider } from "../lib/email-provider.js";
import { runResultsSummary } from "./results-summary.js";

const today = DateTime.now().setZone("UTC").toISODate()!;
const yesterday = DateTime.now().setZone("UTC").minus({ days: 1 }).toISODate()!;

function todayAt(hour: number): Date {
  return DateTime.fromISO(today, { zone: "UTC" }).set({ hour }).toJSDate();
}

function yesterdayAt(hour: number): Date {
  return DateTime.fromISO(yesterday, { zone: "UTC" }).set({ hour }).toJSDate();
}

async function gradePick(pickId: string, outcome: "win" | "loss" | "void"): Promise<void> {
  await db.update(pick).set({ outcome, gradedAt: new Date() }).where(eq(pick.id, pickId));
}

interface ResultsSummaryCall {
  to: string;
  leagueName: string;
  wins: number;
  losses: number;
  rank: number;
  rankChange: number | null;
}

function fakeEmailProvider(): EmailProvider & { resultsSummaryCalls: ResultsSummaryCall[] } {
  const resultsSummaryCalls: ResultsSummaryCall[] = [];
  return {
    resultsSummaryCalls,
    sendVerificationEmail: vi.fn(async () => {}),
    sendEmailChangeVerification: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
    sendDuplicateSignupNotice: vi.fn(async () => {}),
    sendPickReminderEmail: vi.fn(async () => {}),
    sendResultsSummaryEmail: vi.fn(async (to: string, params) => {
      resultsSummaryCalls.push({ to, ...params });
    }),
    sendOperatorDigestEmail: vi.fn(async () => {}),
  };
}

describe("runResultsSummary", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("sends a settled day's record to every eligible active member", async () => {
    const owner = await createTestUser({ email: "alice@example.com", displayName: "Alice" });
    const league = await createTestLeague(owner.id, { timezone: "UTC", sports: ["nfl"] });
    const alice = await createTestLeagueMember(owner.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ email: "bob@example.com", displayName: "Bob" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    const gameA = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    const gameB = await createTestGame({ sport: "nfl", startsAt: todayAt(13), status: "final" });

    await gradePick((await createTestPick(alice.id, gameA.id)).id, "win");
    await gradePick((await createTestPick(alice.id, gameB.id)).id, "win");
    await gradePick((await createTestPick(bob.id, gameA.id)).id, "win");
    await gradePick((await createTestPick(bob.id, gameB.id)).id, "loss");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(2);
    const byEmail = new Map(provider.resultsSummaryCalls.map((c) => [c.to, c]));
    expect(byEmail.get(owner.email)).toMatchObject({ wins: 2, losses: 0, rank: 1 });
    expect(byEmail.get(bobUser.email)).toMatchObject({ wins: 1, losses: 1, rank: 2 });
  });

  it("computes rankChange against yesterday's standings for the same league", async () => {
    const aliceUser = await createTestUser({ email: "alice-rank@example.com", displayName: "Alice" });
    const league = await createTestLeague(aliceUser.id, { timezone: "UTC", sports: ["nfl"] });
    const alice = await createTestLeagueMember(aliceUser.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ email: "bob-rank@example.com", displayName: "Bob" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    // Yesterday: Bob won, Alice lost -> Bob rank 1, Alice rank 2.
    const yesterdayGame = await createTestGame({ sport: "nfl", startsAt: yesterdayAt(12), status: "final" });
    await gradePick((await createTestPick(alice.id, yesterdayGame.id)).id, "loss");
    await gradePick((await createTestPick(bob.id, yesterdayGame.id)).id, "win");

    // Today: Alice wins, Bob loses -> Alice rank 1, Bob rank 2.
    const todayGame = await createTestGame({ sport: "nfl", startsAt: todayAt(12), status: "final" });
    await gradePick((await createTestPick(alice.id, todayGame.id)).id, "win");
    await gradePick((await createTestPick(bob.id, todayGame.id)).id, "loss");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    const byEmail = new Map(provider.resultsSummaryCalls.map((c) => [c.to, c]));
    expect(byEmail.get(aliceUser.email)).toMatchObject({ rank: 1, rankChange: 1 });
    expect(byEmail.get(bobUser.email)).toMatchObject({ rank: 2, rankChange: -1 });
  });

  it("does not send while a game today is still scheduled or in progress", async () => {
    const user = await createTestUser({ email: "unsettled@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    const member = await createTestLeagueMember(user.id, league.id);

    const finalGame = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(member.id, finalGame.id)).id, "win");
    await createTestGame({ sport: "nfl", startsAt: todayAt(20), status: "scheduled" });

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(0);
  });

  it("sends nothing for a league with no games today", async () => {
    const user = await createTestUser({ email: "no-games-today@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(0);
  });

  it("is idempotent: a second run the same day does not double-send", async () => {
    const user = await createTestUser({ email: "once-only-summary@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    const member = await createTestLeagueMember(user.id, league.id);
    const game = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(member.id, game.id)).id, "win");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(1);
    const rows = await db.select().from(notificationLog).where(eq(notificationLog.leagueId, league.id));
    expect(rows).toHaveLength(1);
  });

  it("resumes correctly after a partial failure: a pre-existing notification_log row is not re-sent, remaining members still are", async () => {
    const aliceUser = await createTestUser({ email: "alice-resume@example.com" });
    const league = await createTestLeague(aliceUser.id, { timezone: "UTC", sports: ["nfl"] });
    const alice = await createTestLeagueMember(aliceUser.id, league.id, { role: "commissioner" });
    const bobUser = await createTestUser({ email: "bob-resume@example.com" });
    const bob = await createTestLeagueMember(bobUser.id, league.id);

    const game = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(alice.id, game.id)).id, "win");
    await gradePick((await createTestPick(bob.id, game.id)).id, "loss");

    // Simulate a previous run that crashed after emailing Alice but
    // before reaching Bob.
    await db
      .insert(notificationLog)
      .values({ notificationType: "results_summary", leagueId: league.id, leagueMemberId: alice.id, notificationDate: today });

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(1);
    expect(provider.resultsSummaryCalls[0]?.to).toBe(bobUser.email);
  });

  it("excludes a member who has left the league", async () => {
    const user = await createTestUser({ email: "left-summary@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    const member = await createTestLeagueMember(user.id, league.id, { leftAt: new Date() });
    const game = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(member.id, game.id)).id, "win");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(0);
  });

  it("respects the user's global notifications switch", async () => {
    const user = await createTestUser({ email: "opted-out-global-summary@example.com", notificationsEnabled: false });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    const member = await createTestLeagueMember(user.id, league.id);
    const game = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(member.id, game.id)).id, "win");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(0);
  });

  it("respects the member's per-league notifications switch", async () => {
    const user = await createTestUser({ email: "opted-out-league-summary@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    const member = await createTestLeagueMember(user.id, league.id, { notificationsEnabled: false });
    const game = await createTestGame({ sport: "nfl", startsAt: todayAt(10), status: "final" });
    await gradePick((await createTestPick(member.id, game.id)).id, "win");

    const provider = fakeEmailProvider();
    await runResultsSummary(provider);

    expect(provider.resultsSummaryCalls).toHaveLength(0);
  });
});
