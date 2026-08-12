import { db } from "./client.js";
import { game, league, leagueMember, pick, user } from "./schema.js";

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
    `truncate table "user", league, league_member, game, pick, result, session, verification_token restart identity cascade`,
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
