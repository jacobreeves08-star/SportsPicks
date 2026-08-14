import { db } from "./client.js";
import {
  analyticsEvent,
  game,
  golfPick,
  golfPickSelection,
  jobRun,
  league,
  leagueInviteCode,
  leagueMember,
  leagueMemberReport,
  notificationLog,
  pick,
  pickAuditLog,
  pushToken,
  resultCorrection,
  tournament,
  tournamentEntry,
  user,
} from "./schema.js";

// .returning() types its result as possibly-empty under
// noUncheckedIndexedAccess; a single-row insert always returns exactly
// one row, so fail loudly (not silently propagate `undefined`) if that
// were ever not true — these are test fixtures, not app logic.
function firstOrThrow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected insert().returning() to produce a row");
  return row;
}

/**
 * Support file for integration tests (not itself a test). Truncates
 * every app table — call in `beforeEach` so tests never see leftover
 * rows from a previous test or a prior local `npm run db:seed`.
 * `restart identity cascade` also resets the (unused here, but present)
 * serial sequences and follows FKs so table order doesn't matter.
 */
export async function truncateAllTables(): Promise<void> {
  await db.execute(
    `truncate table "user", league, league_member, league_invite_code, league_member_report, game, pick, pick_audit_log, result, result_correction, session, verification_token, job_run, push_token, notification_log, analytics_event, tournament, tournament_entry, golf_pick, golf_pick_selection restart identity cascade`,
  );
}

let userCounter = 0;

export async function createTestUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  userCounter += 1;
  const rows = await db
    .insert(user)
    .values({
      email: `test-user-${userCounter}@example.com`,
      passwordHash: "unused-in-fixtures",
      displayName: `Test User ${userCounter}`,
      timezone: "UTC",
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestLeague(commissionerId: string, overrides: Partial<typeof league.$inferInsert> = {}) {
  const rows = await db
    .insert(league)
    .values({
      name: "Test League",
      sports: ["nfl"],
      commissionerId,
      timezone: "UTC",
      seasonStart: "2025-09-04",
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestLeagueMember(
  userId: string,
  leagueId: string,
  overrides: Partial<typeof leagueMember.$inferInsert> = {},
) {
  const rows = await db
    .insert(leagueMember)
    .values({ userId, leagueId, role: "member", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

let inviteCodeCounter = 0;

export async function createTestInviteCode(
  leagueId: string,
  overrides: Partial<typeof leagueInviteCode.$inferInsert> = {},
) {
  inviteCodeCounter += 1;
  const rows = await db
    .insert(leagueInviteCode)
    .values({ leagueId, code: `TESTCODE${inviteCodeCounter}`, ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestMemberReport(
  leagueId: string,
  reporterLeagueMemberId: string,
  reportedLeagueMemberId: string,
  overrides: Partial<typeof leagueMemberReport.$inferInsert> = {},
) {
  const rows = await db
    .insert(leagueMemberReport)
    .values({ leagueId, reporterLeagueMemberId, reportedLeagueMemberId, reason: "Test report", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestGame(overrides: Partial<typeof game.$inferInsert> = {}) {
  const rows = await db
    .insert(game)
    .values({
      sport: "nfl",
      homeTeam: "Home",
      awayTeam: "Away",
      startsAt: new Date(),
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestPick(
  leagueMemberId: string,
  gameId: string,
  overrides: Partial<typeof pick.$inferInsert> = {},
) {
  const rows = await db
    .insert(pick)
    .values({ leagueMemberId, gameId, selectedTeam: "Home", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestPickAuditLog(
  leagueMemberId: string,
  gameId: string,
  overrides: Partial<typeof pickAuditLog.$inferInsert> = {},
) {
  const rows = await db
    .insert(pickAuditLog)
    .values({ leagueMemberId, gameId, selectedTeam: "Home", action: "create", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestResultCorrection(
  gameId: string,
  overrides: Partial<typeof resultCorrection.$inferInsert> = {},
) {
  const rows = await db
    .insert(resultCorrection)
    .values({ gameId, oldWinningTeam: "Home", newWinningTeam: "Away", source: "manual", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

let pushTokenCounter = 0;

export async function createTestPushToken(userId: string, overrides: Partial<typeof pushToken.$inferInsert> = {}) {
  pushTokenCounter += 1;
  const rows = await db
    .insert(pushToken)
    .values({ userId, token: `test-push-token-${pushTokenCounter}`, platform: "ios", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestNotificationLog(
  leagueId: string,
  leagueMemberId: string,
  overrides: Partial<typeof notificationLog.$inferInsert> = {},
) {
  const rows = await db
    .insert(notificationLog)
    .values({
      leagueId,
      leagueMemberId,
      notificationType: "pick_reminder",
      notificationDate: new Date().toISOString().slice(0, 10),
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestAnalyticsEvent(overrides: Partial<typeof analyticsEvent.$inferInsert> = {}) {
  const rows = await db
    .insert(analyticsEvent)
    .values({ eventType: "user_signed_up", ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestTournament(overrides: Partial<typeof tournament.$inferInsert> = {}) {
  const now = new Date();
  const rows = await db
    .insert(tournament)
    .values({
      name: "Test Open",
      startsAt: now,
      endsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

let tournamentEntryCounter = 0;

export async function createTestTournamentEntry(
  tournamentId: string,
  overrides: Partial<typeof tournamentEntry.$inferInsert> = {},
) {
  tournamentEntryCounter += 1;
  const rows = await db
    .insert(tournamentEntry)
    .values({
      tournamentId,
      externalId: `test-golfer-${tournamentEntryCounter}`,
      golferName: `Test Golfer ${tournamentEntryCounter}`,
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestGolfPick(
  leagueMemberId: string,
  tournamentId: string,
  overrides: Partial<typeof golfPick.$inferInsert> = {},
) {
  const rows = await db
    .insert(golfPick)
    .values({ leagueMemberId, tournamentId, ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestGolfPickSelection(
  golfPickId: string,
  tournamentEntryId: string,
  overrides: Partial<typeof golfPickSelection.$inferInsert> = {},
) {
  const rows = await db
    .insert(golfPickSelection)
    .values({ golfPickId, tournamentEntryId, ...overrides })
    .returning();
  return firstOrThrow(rows);
}

export async function createTestJobRun(overrides: Partial<typeof jobRun.$inferInsert> = {}) {
  const now = new Date();
  const rows = await db
    .insert(jobRun)
    .values({
      jobName: "test-job",
      startedAt: now,
      finishedAt: now,
      succeeded: true,
      itemCount: 0,
      ...overrides,
    })
    .returning();
  return firstOrThrow(rows);
}
