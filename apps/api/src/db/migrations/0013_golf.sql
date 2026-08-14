-- 0013_golf.sql
-- Golf doesn't fit the game/pick model at all (a tournament has ~69
-- competitors, not a 2-sided matchup), so it gets its own small set of
-- tables rather than reusing game/pick: tournament (the event itself),
-- tournament_entry (one row per golfer in the field, holding their
-- live/final leaderboard position), golf_pick (one row per member per
-- tournament — the "did they get a top-N golfer" outcome, scored as a
-- single win/loss for the whole tournament per the confirmed design,
-- not per golfer), and golf_pick_selection (the golfers within one
-- golf_pick). No audit-trail table for golf picks (unlike pick_audit_log)
-- — deliberately out of scope for this pass, not requested.
--
-- golf_pick_count / golf_top_n are per-league settings, same
-- commissioner-configurable pattern as pick_horizon_days.

alter table league
  add column golf_pick_count integer not null default 3,
  add column golf_top_n integer not null default 10;

alter table league
  add constraint league_golf_pick_count_check check (golf_pick_count between 1 and 10);

alter table league
  add constraint league_golf_top_n_check check (golf_top_n between 1 and 50);

create table tournament (
  id uuid primary key default gen_random_uuid(),
  -- Provider's identifier, for idempotent ingest upserts. Nullable to
  -- allow a manually-entered tournament, same reasoning as game.external_id.
  external_id text unique,
  name text not null,
  starts_at timestamptz not null,
  -- Estimated/actual end — standings credit for a golf pick posts on
  -- the calendar day this falls on (confirmed design decision), not
  -- spread across the tournament's multi-day span.
  ends_at timestamptz not null,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_status_check check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled'))
);

-- Serves the ingest job's "which tournaments need a leaderboard poll"
-- candidate query, same shape as game_status_starts_at_idx.
create index tournament_status_starts_at_idx on tournament (status, starts_at);

create table tournament_entry (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournament (id),
  -- Provider's per-golfer identifier — what a golf_pick_selection
  -- actually references, so a mid-tournament name correction on
  -- re-poll doesn't orphan an existing pick.
  external_id text not null,
  golfer_name text not null,
  -- Live/final leaderboard rank. Null = not yet posted (tournament
  -- hasn't started, or an early round with no score yet) — never
  -- treated as "made the cut," only an explicit small integer does.
  position integer,
  updated_at timestamptz not null default now(),
  unique (tournament_id, external_id)
);

create table golf_pick (
  id uuid primary key default gen_random_uuid(),
  league_member_id uuid not null references league_member (id),
  tournament_id uuid not null references tournament (id),
  -- Same three-value contract as pick.outcome — graded once the
  -- tournament has started, re-graded on every leaderboard poll while
  -- it's still live (confirmed design: grading updates in real time,
  -- not just once at tournament end), 'void' if the tournament is
  -- postponed/cancelled.
  outcome text check (outcome in ('win', 'loss', 'void')),
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_member_id, tournament_id)
);

create index golf_pick_tournament_id_idx on golf_pick (tournament_id);

-- Serves the same "ungraded/needs regrading" style query grading runs
-- against repeatedly for a live tournament.
create index golf_pick_ungraded_idx on golf_pick (tournament_id) where outcome is distinct from 'void';

create table golf_pick_selection (
  id uuid primary key default gen_random_uuid(),
  golf_pick_id uuid not null references golf_pick (id),
  tournament_entry_id uuid not null references tournament_entry (id),
  unique (golf_pick_id, tournament_entry_id)
);

create index golf_pick_selection_golf_pick_id_idx on golf_pick_selection (golf_pick_id);
