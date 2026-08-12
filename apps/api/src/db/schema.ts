import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * All timestamp columns are `timestamptz`, always written/read in UTC.
 * Conversion to a user's or league's local timezone happens only at the
 * presentation boundary (see ../lib/time.ts) — never in schema or queries.
 *
 * `date` columns (season_start) hold a calendar date with no time-of-day,
 * so there's no UTC/local distinction to make for them.
 */

export const user = pgTable("user", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  // IANA time zone name, e.g. "America/Chicago". Validated app-side (Luxon).
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const league = pgTable("league", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  // Sport codes this league covers, e.g. {'nfl','nba'}. A game belongs to
  // this league's slate iff game.sport is in this array (see game table
  // comment) — there is no separate per-league game join table.
  sports: text("sports").array().notNull(),
  commissionerId: uuid("commissioner_id")
    .notNull()
    .references(() => user.id),
  timezone: text("timezone").notNull(),
  seasonStart: date("season_start").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leagueMember = pgTable(
  "league_member",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => league.id),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("league_member_user_league_unique").on(t.userId, t.leagueId),
    check("league_member_role_check", sql`${t.role} in ('commissioner', 'member')`),
  ],
);

export const game = pgTable(
  "game",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Provider's identifier for this game, for idempotent score-poll
    // upserts. Nullable to allow manually-entered games in dev/seed data.
    externalId: text("external_id").unique(),
    sport: text("sport").notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "game_status_check",
      sql`${t.status} in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')`,
    ),
  ],
);

export const pick = pgTable(
  "pick",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMember.id),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id),
    selectedTeam: text("selected_team").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("pick_league_member_game_unique").on(t.leagueMemberId, t.gameId)],
);

// One current result per game. Corrections are UPDATEs (winning_team +
// revision_count via trigger, see migration), never a delete/reinsert —
// see docs/adr and migration comments for the audit-trail rationale.
export const result = pgTable("result", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gameId: uuid("game_id")
    .notNull()
    .unique()
    .references(() => game.id),
  winningTeam: text("winning_team").notNull(),
  source: text("source").notNull(),
  revisionCount: integer("revision_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
