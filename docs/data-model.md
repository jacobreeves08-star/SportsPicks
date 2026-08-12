# Data model (JAC-8)

Source of truth: [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle) and [`apps/api/src/db/migrations/0001_init.sql`](../apps/api/src/db/migrations/0001_init.sql) (hand-written; see note below on why).

## Entities

```
user
  id (uuid, pk)
  email (unique)
  password_hash
  display_name
  timezone            -- IANA name, app-validated
  created_at / updated_at

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
  role                  ('commissioner' | 'member')
  joined_at
  UNIQUE (user_id, league_id)

game                     -- GLOBAL, never duplicated per league
  id (uuid, pk)
  external_id (unique, nullable)  -- provider id, for idempotent score-poll upserts
  sport
  home_team / away_team
  starts_at (timestamptz, UTC)
  status  ('scheduled'|'in_progress'|'final'|'postponed'|'canceled')
  created_at / updated_at

pick
  id (uuid, pk)
  league_member_id -> league_member.id
  game_id          -> game.id
  selected_team
  created_at
  UNIQUE (league_member_id, game_id)

result                   -- SEPARATE from game; corrections are UPDATEs
  id (uuid, pk)
  game_id (unique) -> game.id
  winning_team
  source                 -- e.g. 'provider:espn', 'manual:commissioner', 'seed'
  revision_count          -- auto-incremented by trigger when winning_team changes
  created_at / updated_at
```

## How the hard constraints are met

- **All timestamps UTC:** every `timestamptz` column is written/read as UTC; conversion to a user's/league's local timezone happens only in `apps/api/src/lib/time.ts`, at the presentation boundary. `season_start` is a `date` (no time-of-day), so it has no UTC/local distinction to make.
- **`UNIQUE (league_member, game)` on pick:** `pick_league_member_game_unique`.
- **`result` separate from `game`, corrections audited, not destructive:** `result` is its own table; a `BEFORE UPDATE` trigger (`bump_result_revision`) increments `revision_count` whenever `winning_team` changes and bumps `updated_at`. Corrections are `UPDATE result SET winning_team = ...`, never a delete/reinsert or a write to `game`.
- **Game exists once globally, never duplicated per league:** there is no per-league game/join table. A league's slate is computed as "games where `game.sport` is in `league.sports`" (scoped further by date at query time) — a pick still ties a specific `league_member` to a specific global `game` row via `pick.game_id`.

## Decisions made beyond the literal spec (flagging for your review)

1. **`league_member` has `UNIQUE(user_id, league_id)`** — not explicitly requested, but without it a user could join the same league twice, which would make "compare records against friends" ambiguous. Easy to drop if you want multiple memberships allowed (e.g., re-joining after leaving).
2. **`game.external_id` (unique, nullable)** — added so the score-poll job can upsert idempotently by provider ID without creating duplicate games on re-poll. Nullable so seed/manually-entered games don't need a fake provider ID.
3. **A trigger enforces `pick.selected_team` is one of `game.home_team`/`game.away_team`** — a correctness constraint not explicitly requested, but a pick naming a team not in the game would silently corrupt standings. Enforced in the DB rather than only app-side since it's cheap and this is exactly the kind of invariant a migration should protect once and for all.
4. **No full result-revision history table** — `revision_count` (as you specified) plus `updated_at` is the audit trail. If you want a queryable history of every past `winning_team` value (not just a count), that's an additional `result_revision` table — didn't add it since it wasn't in the entity list and isn't needed until something actually reads history, but flagging it as the natural next step if that need shows up.

## Migration tooling note

`drizzle-kit generate` (the usual way to produce SQL from the Drizzle schema) requires running Node, which isn't available on this machine right now — so `0001_init.sql` is hand-written to match `schema.ts` rather than tool-generated, and applied by a small custom runner (`apps/api/src/db/migrate.ts`) that tracks applied files in a `schema_migrations` table. Once Node/npm are available, this can be verified with `npm run typecheck` and, after you confirm the model, `npm run db:migrate`.

## Seed data (`apps/api/src/db/seed.ts`)

2 users (Alice, Bob) in one league ("Foundations Test League", NFL), a 3-game slate that's already `final` with graded `result` rows, and 6 picks (Alice always picks the actual winner, Bob always picks the home team) — enough to produce a non-trivial standings comparison once that feature exists. Uses fixed UUIDs and `onConflictDoNothing`, so it's safe to re-run.
