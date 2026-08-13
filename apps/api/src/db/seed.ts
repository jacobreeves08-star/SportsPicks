import { DateTime } from "luxon";
import { db, pool } from "./client.js";
import { game, league, leagueMember, pick, result, user } from "./schema.js";
import { logger } from "../lib/logger.js";

/**
 * Creates a 2-member league with a fully graded 3-game slate, so dev/CI
 * has realistic data to work against without ever calling the paid
 * sports API. Fixed UUIDs make this safe to re-run (upserts on conflict).
 */

const ALICE_ID = "00000000-0000-0000-0000-000000000001";
const BOB_ID = "00000000-0000-0000-0000-000000000002";
const LEAGUE_ID = "00000000-0000-0000-0000-000000000010";
const ALICE_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000011";
const BOB_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000012";

const GAME_IDS = [
  "00000000-0000-0000-0000-000000000101",
  "00000000-0000-0000-0000-000000000102",
  "00000000-0000-0000-0000-000000000103",
] as const;

// Fake, non-functional hash — no auth flow exists yet in this phase.
const SEED_PASSWORD_HASH = "seed-fixture-not-a-real-hash";

async function main() {
  await db
    .insert(user)
    .values([
      {
        id: ALICE_ID,
        email: "alice@example.com",
        passwordHash: SEED_PASSWORD_HASH,
        displayName: "Alice",
        timezone: "America/New_York",
      },
      {
        id: BOB_ID,
        email: "bob@example.com",
        passwordHash: SEED_PASSWORD_HASH,
        displayName: "Bob",
        timezone: "America/Los_Angeles",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(league)
    .values({
      id: LEAGUE_ID,
      name: "Foundations Test League",
      sports: ["nfl"],
      commissionerId: ALICE_ID,
      timezone: "America/New_York",
      seasonStart: "2025-09-04",
    })
    .onConflictDoNothing();

  await db
    .insert(leagueMember)
    .values([
      { id: ALICE_MEMBERSHIP_ID, userId: ALICE_ID, leagueId: LEAGUE_ID, role: "commissioner" },
      { id: BOB_MEMBERSHIP_ID, userId: BOB_ID, leagueId: LEAGUE_ID, role: "member" },
    ])
    // Bare onConflictDoNothing() can't infer an arbiter on this table —
    // league_member also has a deferrable EXCLUDE constraint (the
    // commissioner invariant, 0004_leagues_membership.sql), and Postgres
    // won't infer against a deferrable constraint. Naming the actual
    // (non-deferrable) unique constraint sidesteps that entirely.
    .onConflictDoNothing({ target: [leagueMember.userId, leagueMember.leagueId] });

  const games = [
    { id: GAME_IDS[0], home: "Bills", away: "Jets", winner: "Bills" },
    { id: GAME_IDS[1], home: "Packers", away: "Bears", winner: "Bears" },
    { id: GAME_IDS[2], home: "Chiefs", away: "Raiders", winner: "Chiefs" },
  ];

  // All three games kicked off "yesterday" (UTC) and are final, so the
  // slate is fully graded out of the box.
  const kickoff = DateTime.utc().minus({ days: 1 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });

  await db
    .insert(game)
    .values(
      games.map((g, i) => ({
        id: g.id,
        externalId: `seed-${g.id}`,
        sport: "nfl",
        homeTeam: g.home,
        awayTeam: g.away,
        startsAt: kickoff.plus({ hours: i }).toJSDate(),
        status: "final" as const,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(result)
    .values(
      games.map((g) => ({
        gameId: g.id,
        winningTeam: g.winner,
        source: "seed",
      })),
    )
    .onConflictDoNothing();

  // Alice picks the actual winner every time; Bob picks the home team
  // every time — gives a deterministic, non-trivial standings comparison.
  // Graded (outcome/graded_at set) at insert time, same as lib/grading.ts
  // would produce — every game above is already final, and standings
  // (JAC-37-42) read pick.outcome directly, never re-deriving it from
  // `result` on every read.
  const gradedAt = new Date();
  await db
    .insert(pick)
    .values([
      ...games.map((g) => ({
        leagueMemberId: ALICE_MEMBERSHIP_ID,
        gameId: g.id,
        selectedTeam: g.winner,
        outcome: "win" as const,
        gradedAt,
      })),
      ...games.map((g) => ({
        leagueMemberId: BOB_MEMBERSHIP_ID,
        gameId: g.id,
        selectedTeam: g.home,
        outcome: g.home === g.winner ? ("win" as const) : ("loss" as const),
        gradedAt,
      })),
    ])
    .onConflictDoNothing();

  logger.info("seed complete: 2 users, 1 league, 3 graded games, 6 picks");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, "seed failed");
    // process.exitCode, not process.exit() — see comment in migrate.ts.
    process.exitCode = 1;
    return pool.end();
  });
