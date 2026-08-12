# Data model (JAC-8, extended by JAC-13–18, JAC-19–24, JAC-25–30)

Source of truth: [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle) and the migrations in [`apps/api/src/db/migrations/`](../apps/api/src/db/migrations/) (hand-written; see note below on why).

## Entities

```
user
  id (uuid, pk)
  email (unique)
  password_hash
  display_name
  timezone            -- IANA name, app-validated
  pending_email (unique among non-null)  -- awaiting confirmation; email stays valid for login until confirmed
  email_verified_at
  avatar_url          -- client-supplied URL, no upload pipeline
  deletion_requested_at / scheduled_deletion_at / anonymized_at  -- see docs/account-anonymization.md
  created_at / updated_at

session                 -- one row per device/session (JAC-14)
  id (uuid, pk)
  user_id -> user.id
  access_token_hash / refresh_token_hash (sha256, unique)  -- raw tokens never stored
  access_token_expires_at
  refresh_token_expires_at  -- sliding: extended on every refresh
  user_agent / ip_address (nullable, informational)
  created_at / last_used_at / revoked_at

verification_token       -- single-use, expiring; email verify / email change / password reset (JAC-15)
  id (uuid, pk)
  user_id -> user.id
  purpose  ('email_verify' | 'email_change' | 'password_reset')
  token_hash (sha256, unique)
  expires_at
  consumed_at  -- set on use; makes it single-use
  created_at

league
  id (uuid, pk)
  name
  sports (text[])      -- e.g. {'nfl','nba'} — defines the league's slate
  commissioner_id  -> user.id
  timezone
  season_start (date)  -- calendar date, no time component
  created_at / updated_at

league_member
  id (uuid, pk)
  user_id    -> user.id
  league_id  -> league.id
  role                  ('commissioner' | 'member') -- kept in sync with league.commissioner_id
                                                     -- by a trigger, see docs/leagues-and-membership.md
  joined_at
  left_at (nullable)    -- soft leave/remove (JAC-25-30); "active member" = left_at is null
  UNIQUE (user_id, league_id)  -- also what makes "rejoin reactivates the same row" work

league_invite_code       -- one row per league (JAC-25-30)
  id (uuid, pk)
  league_id (unique) -> league.id
  code (unique)             -- 8 chars, alphabet excludes 0/O/1/I/L
  max_uses (nullable)
  uses_count
  expires_at (nullable)
  created_at / updated_at   -- "rotate" overwrites code/resets uses_count on this same row

league_member_report     -- member reporting to the commissioner (JAC-25-30), no review workflow
  id (uuid, pk)
  league_id -> league.id
  reporter_league_member_id -> league_member.id
  reported_league_member_id -> league_member.id
  reason
  created_at

game                     -- GLOBAL, never duplicated per league
  id (uuid, pk)
  external_id (unique, nullable)  -- provider id, for idempotent schedule-ingest/score-poll upserts
  sport
  home_team / away_team
  home_team_external_id / away_team_external_id (nullable)  -- ESPN's stable per-franchise ID;
                                                              -- join key so a name correction on
                                                              -- re-ingest still finds the same row
  allows_draw (boolean, default false)  -- true only for soccer competitions (epl/ucl/mls); gates
                                          -- 'DRAW' as a legal pick.selected_team value
  starts_at (timestamptz, UTC)
  status  ('scheduled'|'in_progress'|'final'|'postponed'|'canceled')
  created_at / updated_at

pick
  id (uuid, pk)
  league_member_id -> league_member.id
  game_id          -> game.id
  selected_team    -- team name, or the literal 'DRAW' sentinel (soccer only, see game.allows_draw)
  created_at
  UNIQUE (league_member_id, game_id)

result                   -- SEPARATE from game; corrections are UPDATEs
  id (uuid, pk)
  game_id (unique) -> game.id
  winning_team            -- team name, or the literal 'DRAW' sentinel for a level soccer final
  source                  -- literal 'espn' from the pipeline; 'manual:commissioner' or 'seed' otherwise
  revision_count          -- auto-incremented by trigger when winning_team changes
  created_at / updated_at

job_run                  -- cross-run memory for stateless cron-triggered jobs (JAC-24)
  id (uuid, pk)
  job_name                -- 'schedule-ingest' | 'score-poll'
  started_at / finished_at (nullable)
  succeeded (nullable)
  item_count (nullable)   -- games upserted (schedule-ingest) or finalized (score-poll) this run
  error_message (nullable)
  created_at
```

## How the hard constraints are met

- **All timestamps UTC:** every `timestamptz` column is written/read as UTC; conversion to a user's/league's local timezone happens only in `apps/api/src/lib/time.ts`, at the presentation boundary. `season_start` is a `date` (no time-of-day), so it has no UTC/local distinction to make.
- **`UNIQUE (league_member, game)` on pick:** `pick_league_member_game_unique`.
- **`result` separate from `game`, corrections audited, not destructive:** `result` is its own table; a `BEFORE UPDATE` trigger (`bump_result_revision`) increments `revision_count` whenever `winning_team` changes and bumps `updated_at`. Corrections are `UPDATE result SET winning_team = ...`, never a delete/reinsert or a write to `game`.
- **Game exists once globally, never duplicated per league:** there is no per-league game/join table. A league's slate is computed as "games where `game.sport` is in `league.sports`" (scoped further by date at query time) — a pick still ties a specific `league_member` to a specific global `game` row via `pick.game_id`.

## Decisions made beyond the literal spec (flagging for your review)

1. **`league_member` has `UNIQUE(user_id, league_id)`** — not explicitly requested, but without it a user could join the same league twice, which would make "compare records against friends" ambiguous. **Resolved in JAC-25-30, not dropped**: leaving/removal is a soft `left_at` marker rather than a `DELETE`, so this constraint now does double duty — it's exactly what forces a rejoin to reactivate the same row (via `ON CONFLICT DO UPDATE SET left_at = null`) instead of inserting a second one, which is what makes "rejoining restores prior picks" true for free. See `docs/leagues-and-membership.md`.
2. **`game.external_id` (unique, nullable)** — added so the score-poll job can upsert idempotently by provider ID without creating duplicate games on re-poll. Nullable so seed/manually-entered games don't need a fake provider ID.
3. **A trigger enforces `pick.selected_team` is one of `game.home_team`/`game.away_team`, or `'DRAW'` when `game.allows_draw`** — a correctness constraint not explicitly requested, but a pick naming a team not in the game would silently corrupt standings. Enforced in the DB rather than only app-side since it's cheap and this is exactly the kind of invariant a migration should protect once and for all. Extended in JAC-19–24 (`check_pick_selected_team`, `0003_sports_pipeline.sql`) to accept the `'DRAW'` sentinel, but only for games where `allows_draw` is true — a `'DRAW'` pick against a non-soccer game is still rejected at the database level.
4. **No full result-revision history table** — `revision_count` (as you specified) plus `updated_at` is the audit trail. If you want a queryable history of every past `winning_team` value (not just a count), that's an additional `result_revision` table — didn't add it since it wasn't in the entity list and isn't needed until something actually reads history, but flagging it as the natural next step if that need shows up.
5. **`pending_email` instead of overwriting `email` in place on a change request** — the old, verified email keeps working for login until the new one is confirmed via a `verification_token` (purpose `email_change`). More correct/secure than immediately swapping `email` and re-unverifying it: a change request can't briefly lock someone out or let an attacker who only controls the new inbox take over login before confirmation.
6. **Anonymized accounts get a deterministic tombstone email (`deleted-<user_id>@tombstone.invalid`), not `null`** — keeps `email`'s existing `NOT NULL UNIQUE` constraint intact rather than loosening it for one code path. See `docs/account-anonymization.md` for the full anonymization spec.
7. **Issuing a new `verification_token` invalidates the user's prior unconsumed tokens of the same `purpose`** — not explicitly requested, but without it, requesting a second password-reset email leaves two valid reset links outstanding, which is a real (if minor) footgun. Enforced in `lib/verification-tokens.ts`, not the DB, since "delete rows matching a condition" doesn't need a trigger.
8. **No refresh-token reuse-detection / session-family revocation** — a stolen-and-reused rotated-away refresh token is currently indistinguishable from any other invalid token (both just fail lookup). Detecting reuse specifically (and revoking the whole session family in response) is a real, known hardening step, deliberately deferred — see `docs/adr/0002-auth-session-hashing-email.md`.
9. **`home_team_external_id`/`away_team_external_id`, not a full `team` table (JAC-19–24)** — confirmed with the user directly. Keeps team identity lightweight; the two columns exist purely as a stable join key for `schedule-ingest`'s upsert, so a team's stored display name self-corrects on re-ingest without introducing a normalized entity or touching pick-ownership semantics. See `docs/adr/0003-sports-data-pipeline.md`.
10. **`'DRAW'` as a literal sentinel string in `pick.selected_team`/`result.winning_team`, not a separate boolean column** — confirmed with the user directly (the alternative considered was voiding draws entirely). Keeps grading uniform (`pick.selected_team === result.winning_team`) with no special-casing for soccer, at the cost of a "magic string" that must never collide with a real team name — mitigated by `allows_draw`'s DB-level gate, which makes `'DRAW'` illegal as a pick value for any non-soccer game.
11. **`job_run` is append-only, not upserted per job** — one row is written once, at the end of each run (success or caught failure), rather than inserted-at-start and updated-at-end. Simpler, and the full run history is a users-facing debugging aid for free; nothing currently reads more than the latest row or latest successful row (`getJobRunStatus`), but keeping history costs nothing and wasn't worth trading away for a marginally smaller table.
12. **`league.commissioner_id` stays the single source of truth for the commissioner invariant; `league_member.role` is a trigger-synced denormalized column, backstopped by a deferrable EXCLUDE constraint (JAC-25-30)** — confirmed the design during planning, not something the literal spec asked for at this level of detail. See `docs/leagues-and-membership.md` for the full reasoning, including why a plain unique index couldn't do this job.
13. **`league_invite_code` is one row per league, not a history table (JAC-25-30)** — "rotatable" is satisfied by overwriting `code` and resetting `uses_count` in place. If a future need arises to audit past codes (e.g., "who joined via which code"), that's a separate `league_invite_code_redemption` table — not built now since nothing asks for that history yet.
14. **No ban/block-rejoin list (JAC-25-30)** — a member removed by the commissioner can rejoin via the invite code exactly like anyone else; removal stops participation *now*, it isn't a ban. A real moderation/ban feature isn't in the literal spec; `league_member_report` gives the commissioner visibility without building one.

## Migration tooling note

`drizzle-kit generate` (the usual way to produce SQL from the Drizzle schema) isn't used — migrations are hand-written to match `schema.ts` rather than tool-generated (this predates Node being installed on the maintainer's machine, and hand-writing turned out to be a fine steady-state choice, not just a workaround — see `0001_init.sql`/`0002_auth.sql`), and applied by a small custom runner (`apps/api/src/db/migrate.ts`) that tracks applied files in a `schema_migrations` table.

## Seed data (`apps/api/src/db/seed.ts`)

2 users (Alice, Bob) in one league ("Foundations Test League", NFL), a 3-game slate that's already `final` with graded `result` rows, and 6 picks (Alice always picks the actual winner, Bob always picks the home team) — enough to produce a non-trivial standings comparison once that feature exists. Uses fixed UUIDs and `onConflictDoNothing`, so it's safe to re-run.
