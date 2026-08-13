import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { notificationLog } from "../db/schema.js";
import {
  createTestGame,
  createTestLeague,
  createTestLeagueMember,
  createTestPick,
  createTestUser,
  truncateAllTables,
} from "../db/test-helpers.js";
import type { EmailProvider, PickReminderGame } from "../lib/email-provider.js";
import { runPickReminder } from "./pick-reminder.js";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function fakeEmailProvider(): EmailProvider & {
  pickReminderCalls: { to: string; leagueName: string; unpickedGames: PickReminderGame[] }[];
} {
  const pickReminderCalls: { to: string; leagueName: string; unpickedGames: PickReminderGame[] }[] = [];
  return {
    pickReminderCalls,
    sendVerificationEmail: vi.fn(async () => {}),
    sendEmailChangeVerification: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
    sendDuplicateSignupNotice: vi.fn(async () => {}),
    sendPickReminderEmail: vi.fn(async (to: string, params) => {
      pickReminderCalls.push({ to, leagueName: params.leagueName, unpickedGames: params.unpickedGames });
    }),
    sendResultsSummaryEmail: vi.fn(async () => {}),
    sendOperatorDigestEmail: vi.fn(async () => {}),
  };
}

describe("runPickReminder", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reminds a member with an unpicked game inside the lead-time window, not a member who's already picked everything", async () => {
    const picker = await createTestUser({ email: "picker@example.com" });
    const laggard = await createTestUser({ email: "laggard@example.com" });
    const league = await createTestLeague(picker.id, { timezone: "UTC", sports: ["nfl"] });
    const pickerMember = await createTestLeagueMember(picker.id, league.id);
    await createTestLeagueMember(laggard.id, league.id);
    const game = await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });
    await createTestPick(pickerMember.id, game.id, { selectedTeam: "Home" });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(1);
    expect(provider.pickReminderCalls[0]?.to).toBe(laggard.email);
    expect(provider.pickReminderCalls[0]?.unpickedGames).toHaveLength(1);
  });

  it("does not send when the first lock is farther out than the lead-time window", async () => {
    const user = await createTestUser({ email: "far-future@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(180) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("does not send when the first lock has already passed", async () => {
    const user = await createTestUser({ email: "already-locked@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(-30) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("is idempotent: a second run in the same window does not double-send", async () => {
    const user = await createTestUser({ email: "once-only@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(1);

    const rows = await db.select().from(notificationLog).where(eq(notificationLog.leagueId, league.id));
    expect(rows).toHaveLength(1);
  });

  it("excludes a member who has left the league", async () => {
    const user = await createTestUser({ email: "departed@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id, { leftAt: new Date() });
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("excludes postponed and canceled games from both the lock computation and the unpicked set", async () => {
    const user = await createTestUser({ email: "postponed-only@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    // The only game today is postponed and would (if counted) fall inside
    // the window — it must not produce a first lock, and therefore no send.
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30), status: "postponed" });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("still reminds about a real game when a separate postponed game is excluded from the unpicked count", async () => {
    const user = await createTestUser({ email: "mixed-slate@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(35), status: "canceled" });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(1);
    // Only the real game should show up as unpicked, not the canceled one.
    expect(provider.pickReminderCalls[0]?.unpickedGames).toHaveLength(1);
  });

  it("sends nothing for a league with no games today", async () => {
    const user = await createTestUser({ email: "no-games@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("respects the user's global notifications switch", async () => {
    const user = await createTestUser({ email: "opted-out-globally@example.com", notificationsEnabled: false });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("respects the member's per-league notifications switch", async () => {
    const user = await createTestUser({ email: "opted-out-per-league@example.com" });
    const league = await createTestLeague(user.id, { timezone: "UTC", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id, { notificationsEnabled: false });
    await createTestGame({ sport: "nfl", startsAt: minutesFromNow(30) });

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(0);
  });

  it("correctly computes today's window across a DST spring-forward transition", async () => {
    // 2026-03-08 is the US spring-forward date: America/Chicago jumps from
    // CST (UTC-6) to CDT (UTC-5) at 02:00 local. Local midnight that day is
    // still CST, so day-start is 2026-03-08T06:00:00Z, but day-end (midnight
    // of the 9th, already CDT) is 2026-03-09T05:00:00Z — a 23-hour calendar
    // day. A naive "+24h" computation would instead land on
    // 2026-03-09T06:00:00Z, wrongly including an hour that belongs to the
    // 9th. dayBoundsUtc is Luxon-zone-aware and must get this right.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-08T05:15:00.000Z")); // 2026-03-07 23:15 CST — still "yesterday" locally

    const user = await createTestUser({ email: "dst@example.com" });
    const league = await createTestLeague(user.id, { timezone: "America/Chicago", sports: ["nfl"] });
    await createTestLeagueMember(user.id, league.id);
    // 2026-03-09T04:45:00Z = 2026-03-08 23:45 CDT — inside the shortened
    // 23-hour "today" for 2026-03-08, and inside the 60-minute lead window
    // measured from the frozen "now" below.
    await createTestGame({ sport: "nfl", startsAt: new Date("2026-03-09T04:45:00.000Z") });

    vi.setSystemTime(new Date("2026-03-09T04:15:00.000Z")); // 30 minutes before that lock

    const provider = fakeEmailProvider();
    await runPickReminder(provider);

    expect(provider.pickReminderCalls).toHaveLength(1);
    expect(provider.pickReminderCalls[0]?.to).toBe(user.email);
  });
});
