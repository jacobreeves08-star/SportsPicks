import { DateTime } from "luxon";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { game, league, leagueMember, pick, result, tournament, tournamentEntry, user } from "./schema.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";

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

const TOURNAMENT_ID = "00000000-0000-0000-0000-000000000300";

const FIGHT_IDS = [
  "00000000-0000-0000-0000-000000000201",
  "00000000-0000-0000-0000-000000000202",
] as const;

// Real, stable ESPN CDN paths — the same URLs schedule-ingest would
// write. Hardcoded here (rather than hitting the network from a seed)
// so a local slate shows the crest treatment the design assumes, which
// an all-null fixture silently hides.
const NFL_LOGO = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
const COUNTRY_FLAG = (code: string) => `https://a.espncdn.com/i/teamlogos/countries/500/${code}.png`;

// Both seed users share this password so dev can actually log in as
// them. Hashed at seed time with the real argon2 params rather than
// pasted as a literal digest — a hardcoded hash would silently stop
// verifying the day ARGON2_OPTIONS changes.
const SEED_PASSWORD = "password123";

async function main() {
  const seedPasswordHash = await hashPassword(SEED_PASSWORD);

  await db
    .insert(user)
    .values([
      {
        id: ALICE_ID,
        email: "alice@example.com",
        passwordHash: seedPasswordHash,
        displayName: "Alice",
        timezone: "America/New_York",
        // Pre-verified: nothing would deliver the verification email in
        // dev (EMAIL_PROVIDER=mock only logs the link), so an unverified
        // fixture would strand the profile screen on a "verify your
        // email" state that can never be cleared through the UI.
        emailVerifiedAt: new Date(),
      },
      {
        id: BOB_ID,
        email: "bob@example.com",
        passwordHash: seedPasswordHash,
        displayName: "Bob",
        timezone: "America/Los_Angeles",
        emailVerifiedAt: new Date(),
      },
    ])
    // Not onConflictDoNothing like the rows below: a database seeded
    // before these users had a working password hash still holds the old
    // unusable digest, and doNothing would leave it that way forever.
    // Re-running the seed has to repair the credential, not skip it.
    .onConflictDoUpdate({
      target: user.id,
      set: { passwordHash: seedPasswordHash, emailVerifiedAt: new Date() },
    });

  await db
    .insert(league)
    .values({
      id: LEAGUE_ID,
      name: "Foundations Test League",
      // MMA rides along with NFL so the slate covers BOTH badge paths in
      // one screen: franchises that have a crest, and fighters who have
      // only a country flag. Golf is here for its own separate screen,
      // which is entirely individuals and so is flag-only.
      sports: ["nfl", "mma", "golf"],
      commissionerId: ALICE_ID,
      timezone: "America/New_York",
      seasonStart: "2025-09-04",
    })
    .onConflictDoUpdate({ target: league.id, set: { sports: ["nfl", "mma", "golf"] } });

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
    { id: GAME_IDS[0], home: "Bills", away: "Jets", winner: "Bills", homeLogo: "buf", awayLogo: "nyj" },
    { id: GAME_IDS[1], home: "Packers", away: "Bears", winner: "Bears", homeLogo: "gb", awayLogo: "chi" },
    { id: GAME_IDS[2], home: "Chiefs", away: "Raiders", winner: "Chiefs", homeLogo: "kc", awayLogo: "lv" },
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
        homeTeamLogoUrl: NFL_LOGO(g.homeLogo),
        awayTeamLogoUrl: NFL_LOGO(g.awayLogo),
        startsAt: kickoff.plus({ hours: i }).toJSDate(),
        status: "final" as const,
      })),
    )
    // Upsert rather than doNothing so a database seeded before these
    // logo URLs existed picks them up on the next run, same reasoning
    // as the user rows above.
    .onConflictDoUpdate({
      target: game.id,
      set: { homeTeamLogoUrl: sql`excluded.home_team_logo_url`, awayTeamLogoUrl: sql`excluded.away_team_logo_url` },
    });

  // Two MMA fights, deliberately UNGRADED and in the future: fighters
  // are people, so neither side has a crest and both fall back to the
  // country flag. Keeping them open also leaves the slate with
  // something actually pickable — the NFL games above are all final.
  const fights = [
    { id: FIGHT_IDS[0], home: "Islam Makhachev", away: "Jack Della Maddalena", homeFlag: "rus", awayFlag: "aus" },
    { id: FIGHT_IDS[1], home: "Sean O'Malley", away: "Merab Dvalishvili", homeFlag: "usa", awayFlag: "geo" },
  ];

  const firstBell = DateTime.utc().plus({ days: 1 }).set({ hour: 23, minute: 0, second: 0, millisecond: 0 });

  await db
    .insert(game)
    .values(
      fights.map((f, i) => ({
        id: f.id,
        externalId: `seed-${f.id}`,
        sport: "mma",
        homeTeam: f.home,
        awayTeam: f.away,
        homeTeamFlagUrl: COUNTRY_FLAG(f.homeFlag),
        awayTeamFlagUrl: COUNTRY_FLAG(f.awayFlag),
        startsAt: firstBell.plus({ minutes: i * 30 }).toJSDate(),
        status: "scheduled" as const,
      })),
    )
    .onConflictDoUpdate({
      target: game.id,
      set: {
        startsAt: sql`excluded.starts_at`,
        homeTeamFlagUrl: sql`excluded.home_team_flag_url`,
        awayTeamFlagUrl: sql`excluded.away_team_flag_url`,
      },
    });

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

  // An upcoming golf tournament with a small field. Golf's whole
  // leaderboard is individuals, so the flag is the ONLY badge these
  // rows can ever show — one golfer is left flagless on purpose so the
  // name-only fallback is visible locally too, not just in tests.
  await db
    .insert(tournament)
    .values({
      id: TOURNAMENT_ID,
      externalId: `seed-${TOURNAMENT_ID}`,
      name: "Seed Invitational",
      startsAt: firstBell.plus({ days: 1 }).toJSDate(),
      endsAt: firstBell.plus({ days: 4 }).toJSDate(),
      status: "scheduled",
    })
    .onConflictDoUpdate({
      target: tournament.id,
      set: { startsAt: sql`excluded.starts_at`, endsAt: sql`excluded.ends_at` },
    });

  const golfers = [
    { externalId: "seed-g1", name: "Scottie Scheffler", flag: "usa" },
    { externalId: "seed-g2", name: "Rory McIlroy", flag: "nir" },
    { externalId: "seed-g3", name: "Hideki Matsuyama", flag: "jpn" },
    { externalId: "seed-g4", name: "Ludvig Åberg", flag: null },
  ];

  await db
    .insert(tournamentEntry)
    .values(
      golfers.map((g) => ({
        tournamentId: TOURNAMENT_ID,
        externalId: g.externalId,
        golferName: g.name,
        flagUrl: g.flag === null ? null : COUNTRY_FLAG(g.flag),
      })),
    )
    .onConflictDoUpdate({
      target: [tournamentEntry.tournamentId, tournamentEntry.externalId],
      set: { flagUrl: sql`excluded.flag_url` },
    });

  logger.info(
    { login: `alice@example.com / bob@example.com, password: ${SEED_PASSWORD}` },
    "seed complete: 2 users, 1 league, 3 graded NFL games, 2 open MMA fights, 6 picks",
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, "seed failed");
    // process.exitCode, not process.exit() — see comment in migrate.ts.
    process.exitCode = 1;
    return pool.end();
  });
