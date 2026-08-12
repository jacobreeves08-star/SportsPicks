import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  unique,
  uniqueIndex,
  index,
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

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    // IANA time zone name, e.g. "America/Chicago". Validated app-side (Luxon).
    timezone: text("timezone").notNull(),
    // Set while an email change is awaiting confirmation; `email` itself
    // keeps working for login until the new address is verified (see
    // lib/verification-tokens.ts, purpose 'email_change').
    pendingEmail: text("pending_email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    avatarUrl: text("avatar_url"),
    // Self-serve deletion (JAC-18): request starts the grace-period clock;
    // the anonymize-accounts cron job (apps/api/src/jobs/anonymize-accounts.ts)
    // scrubs personal fields once scheduled_deletion_at has passed, without
    // deleting the user/league_member/pick rows themselves. See
    // docs/account-anonymization.md for the exact behavior.
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    scheduledDeletionAt: timestamp("scheduled_deletion_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_pending_email_unique_idx")
      .on(t.pendingEmail)
      .where(sql`${t.pendingEmail} is not null`),
  ],
);

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

// One row per device/session. Refresh rotates both tokens in place
// (overwrites the hashes + extends refreshTokenExpiresAt) rather than
// inserting a new row — not a token-history table. See lib/session.ts.
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    // sha256 hex of the opaque token — the raw token only ever exists in
    // the response body / Authorization header, never at rest.
    accessTokenHash: text("access_token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    // Sliding: extended by AUTH_REFRESH_TOKEN_TTL_DAYS on every rotation,
    // so an actively-returning user is never forced to re-authenticate.
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

// Single generic table for every single-use, expiring token sent by
// email. Issuing a new token of a given purpose for a user invalidates
// that user's prior unconsumed tokens of the same purpose (see
// lib/verification-tokens.ts), so a stale link can never coexist with a
// fresher one.
export const verificationToken = pgTable(
  "verification_token",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "verification_token_purpose_check",
      sql`${t.purpose} in ('email_verify', 'email_change', 'password_reset')`,
    ),
    index("verification_token_user_purpose_idx").on(t.userId, t.purpose),
  ],
);
