import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  boolean,
  jsonb,
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
    // Global notifications off switch (JAC-43-48) — checked first,
    // short-circuits regardless of any per-league league_member
    // preference. See docs/notifications.md.
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_pending_email_unique_idx")
      .on(t.pendingEmail)
      .where(sql`${t.pendingEmail} is not null`),
  ],
);

export const league = pgTable(
  "league",
  {
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
    // How many days ahead a member can see a game as pickable — bounds
    // both the home screen's `unpickedCount` (leagues.routes.ts) and the
    // actual pick-write enforcement (lib/pick-write.ts), commissioner-
    // configurable via PATCH /:leagueId. Default of 7 (a week); the
    // check below caps it at 30 so a league can't accidentally recreate
    // the old unbounded behavior.
    pickHorizonDays: integer("pick_horizon_days").notNull().default(7),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("league_pick_horizon_days_check", sql`${t.pickHorizonDays} between 1 and 30`)],
);

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
    // Soft leave/remove (JAC-25-30) — never a DELETE, so historical picks
    // (which reference this row, not the league directly) stay intact
    // for standings integrity. "Active member" = leftAt is null,
    // everywhere. The unique(userId, leagueId) constraint below forces a
    // rejoin to reactivate THIS row rather than insert a new one, which
    // is what makes "rejoining restores prior picks" true for free.
    leftAt: timestamp("left_at", { withTimezone: true }),
    // Per-league notification preference (JAC-43-48) — see
    // docs/notifications.md. user.notificationsEnabled is checked
    // first and short-circuits regardless of this.
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  },
  (t) => [
    unique("league_member_user_league_unique").on(t.userId, t.leagueId),
    check("league_member_role_check", sql`${t.role} in ('commissioner', 'member')`),
    // NOTE: league_member_one_commissioner_per_league (a deferrable
    // partial EXCLUDE constraint backing the commissioner invariant) is
    // NOT representable here — drizzle-orm's pg-core has no EXCLUDE
    // constraint builder. It exists only in 0004_leagues_membership.sql,
    // same as triggers and other raw-SQL-only constructs elsewhere in
    // this schema (e.g. set_updated_at, check_pick_selected_team).
  ],
);

// One invite code per league (one-to-one via the unique on leagueId).
// Rotation overwrites `code`/resets `usesCount` in place — no history
// table, see docs/leagues-and-membership.md.
export const leagueInviteCode = pgTable("league_invite_code", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leagueId: uuid("league_id")
    .notNull()
    .unique()
    .references(() => league.id),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses"),
  usesCount: integer("uses_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Member reporting to the commissioner (JAC-30) — a visible list, no
// review workflow or notification (Epic 7 doesn't exist yet).
export const leagueMemberReport = pgTable(
  "league_member_report",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => league.id),
    reporterLeagueMemberId: uuid("reporter_league_member_id")
      .notNull()
      .references(() => leagueMember.id),
    reportedLeagueMemberId: uuid("reported_league_member_id")
      .notNull()
      .references(() => leagueMember.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("league_member_report_league_id_idx").on(t.leagueId)],
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
    // Provider's stable per-franchise ID for each side (JAC-20) — kept
    // alongside the display-name text so re-ingest always corrects a
    // drifted name via a stable join key, without needing a full team
    // entity table. Nullable: unset for manually-entered games.
    homeTeamExternalId: text("home_team_external_id"),
    awayTeamExternalId: text("away_team_external_id"),
    // ESPN's `competitor.team.logo` — a stable per-franchise CDN URL.
    // Nullable/re-ingest-corrected for the same reasons as the external
    // IDs above.
    homeTeamLogoUrl: text("home_team_logo_url"),
    awayTeamLogoUrl: text("away_team_logo_url"),
    // ESPN's `competitor.team.color` — 6-digit hex, no leading '#'.
    // Nullable/re-ingest-corrected for the same reasons as the logo
    // URLs above.
    homeTeamColor: text("home_team_color"),
    awayTeamColor: text("away_team_color"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    // Set by schedule-ingest based on sport (true only for soccer
    // competitions) — the single source of truth for whether 'DRAW' is
    // a legal pick.selected_team for this game (see check_pick_selected_team).
    allowsDraw: boolean("allows_draw").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "game_status_check",
      sql`${t.status} in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')`,
    ),
    // Serves score-poll's "started but not final" candidate query.
    index("game_status_starts_at_idx").on(t.status, t.startsAt),
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
    // Graded outcome (JAC-37-42), written once at grade time by
    // lib/grading.ts — standings read this directly, never re-deriving
    // it from `result` on every read. Null until graded. 'void' for a
    // postponed/cancelled game: never counted as a loss.
    outcome: text("outcome"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => [
    unique("pick_league_member_game_unique").on(t.leagueMemberId, t.gameId),
    check("pick_outcome_check", sql`${t.outcome} in ('win', 'loss', 'void')`),
    // Serves both grading writes (idempotent via this same predicate)
    // and the reconciliation sweep in score-poll.ts — see
    // 0006_scoring.sql's comment.
    index("pick_ungraded_idx")
      .on(t.gameId)
      .where(sql`${t.outcome} is null`),
  ],
);

// Append-only audit trail of every pick write (JAC-31-36) — never
// mutated or deleted by application code, backstopped at the DB level
// by BEFORE UPDATE/DELETE triggers that unconditionally raise (see
// 0005_picks.sql). This is the record that resolves "I definitely
// picked them" disputes, so it exists independently of `pick` itself
// (which only ever holds each member's CURRENT selection per game).
export const pickAuditLog = pgTable(
  "pick_audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMember.id),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id),
    selectedTeam: text("selected_team").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("pick_audit_log_action_check", sql`${t.action} in ('create', 'change')`),
    index("pick_audit_log_league_member_id_idx").on(t.leagueMemberId),
    index("pick_audit_log_game_id_idx").on(t.gameId),
  ],
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

// "Notify affected members that their record changed and why" (JAC-40)
// — no notification DELIVERY system exists yet (Epic 7), so this is a
// documented, queryable record (same pattern as league_member_report):
// the correction endpoint's response includes affected members
// directly, and this table keeps the history visible to any member
// afterward, not just the commissioner who triggered a manual one.
export const resultCorrection = pgTable(
  "result_correction",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gameId: uuid("game_id")
      .notNull()
      .references(() => game.id),
    oldWinningTeam: text("old_winning_team").notNull(),
    newWinningTeam: text("new_winning_team").notNull(),
    source: text("source").notNull(),
    // Both null for an automatic provider-revision correction; set for
    // a manual one — game/result are global (shared across every
    // league covering that sport), so a manual correction from one
    // league's commissioner can affect other leagues too. This is what
    // makes that fully attributed rather than anonymous.
    correctedByUserId: uuid("corrected_by_user_id").references(() => user.id),
    correctedFromLeagueId: uuid("corrected_from_league_id").references(() => league.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("result_correction_source_check", sql`${t.source} in ('provider_revision', 'manual')`),
    index("result_correction_game_id_idx").on(t.gameId),
  ],
);

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

// Push-token registration contract (JAC-43-48) — documented but not
// wired to a live route this epic (no native client exists in this
// repo to register one; email is the only delivery channel built).
// See docs/notifications.md. Deleted outright (not anonymized) by
// anonymize-accounts.ts, same category as session/verification_token.
export const pushToken = pgTable(
  "push_token",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("push_token_platform_check", sql`${t.platform} in ('ios', 'android', 'web')`),
    index("push_token_user_id_idx").on(t.userId),
  ],
);

// Idempotency guard for the pick-reminder and results-summary jobs
// (JAC-43-48) — deliberately its own table, not reused from
// analytics_event or any other log, so this table's schema isn't
// constrained by an unrelated concern. See docs/notifications.md. The
// unique index is what makes "reserve, then send only if the insert
// actually returned a row" work as one atomic statement, the same
// idiom score-poll.ts already uses for exactly-once finalization.
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    notificationType: text("notification_type").notNull(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => league.id),
    leagueMemberId: uuid("league_member_id")
      .notNull()
      .references(() => leagueMember.id),
    notificationDate: date("notification_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "notification_log_type_check",
      sql`${t.notificationType} in ('pick_reminder', 'results_summary')`,
    ),
    uniqueIndex("notification_log_dedupe_idx").on(t.notificationType, t.leagueMemberId, t.notificationDate),
    index("notification_log_league_id_idx").on(t.leagueId),
  ],
);

// Self-built analytics event log (JAC-44) — no third-party platform,
// no client SDK, since every listed event is server-observable. See
// docs/analytics.md. userId/leagueId/leagueMemberId are all nullable
// (a signup event has no league yet) and never cascade-deleted, same
// posture every other FK in this schema already takes, since rows are
// anonymized rather than hard-deleted (docs/account-anonymization.md).
export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    userId: uuid("user_id").references(() => user.id),
    leagueId: uuid("league_id").references(() => league.id),
    leagueMemberId: uuid("league_member_id").references(() => leagueMember.id),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analytics_event_type_created_at_idx").on(t.eventType, t.createdAt)],
);

// Cross-run memory for the schedule-ingest and score-poll cron jobs
// (JAC-24) — a cron-triggered process is short-lived with no in-memory
// state between invocations, so "has this job succeeded recently"/"did
// the last run find anything" need somewhere durable to live. One row
// per run, written once at the end (not inserted-then-updated).
export const jobRun = pgTable(
  "job_run",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    succeeded: boolean("succeeded"),
    itemCount: integer("item_count"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_run_job_name_started_at_idx").on(t.jobName, t.startedAt)],
);
