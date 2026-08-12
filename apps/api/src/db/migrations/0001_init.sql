-- 0001_init.sql
-- Foundation schema: user, league, league_member, game, pick, result.
-- All timestamptz columns are UTC; conversion happens only at presentation
-- (see apps/api/src/lib/time.ts). `season_start` is a plain date (no
-- time-of-day), so it has no UTC/local distinction.

create extension if not exists pgcrypto;

-- Generic "touch updated_at on any change" trigger, reused by every table
-- that has an updated_at column.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table "user" (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_set_updated_at
  before update on "user"
  for each row execute function set_updated_at();

create table league (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sports text[] not null,
  commissioner_id uuid not null references "user"(id),
  timezone text not null,
  season_start date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index league_commissioner_id_idx on league(commissioner_id);

create trigger league_set_updated_at
  before update on league
  for each row execute function set_updated_at();

create table league_member (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  league_id uuid not null references league(id),
  role text not null check (role in ('commissioner', 'member')),
  joined_at timestamptz not null default now(),
  constraint league_member_user_league_unique unique (user_id, league_id)
);

create index league_member_league_id_idx on league_member(league_id);

-- Games are global, never duplicated per league. A league's slate is the
-- set of games whose sport appears in league.sports — there is no
-- per-league game join table.
create table game (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  sport text not null,
  home_team text not null,
  away_team text not null,
  starts_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index game_sport_starts_at_idx on game(sport, starts_at);

create trigger game_set_updated_at
  before update on game
  for each row execute function set_updated_at();

create table pick (
  id uuid primary key default gen_random_uuid(),
  league_member_id uuid not null references league_member(id),
  game_id uuid not null references game(id),
  selected_team text not null,
  created_at timestamptz not null default now(),
  constraint pick_league_member_game_unique unique (league_member_id, game_id)
);

create index pick_game_id_idx on pick(game_id);

-- A pick must name one of the two teams actually playing in the game.
create or replace function check_pick_selected_team()
returns trigger as $$
declare
  home text;
  away text;
begin
  select home_team, away_team into home, away from game where id = new.game_id;
  if new.selected_team not in (home, away) then
    raise exception 'selected_team % is not a participant in game %', new.selected_team, new.game_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger pick_check_selected_team
  before insert or update on pick
  for each row execute function check_pick_selected_team();

-- Separate from game: outcomes get revised. Corrections are UPDATEs, never
-- a destructive overwrite of game state. revision_count is the audit
-- trail — it increments automatically whenever winning_team changes, so
-- "how many times has this been corrected" is always answerable without
-- a full history table.
create table result (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references game(id),
  winning_team text not null,
  source text not null,
  revision_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function bump_result_revision()
returns trigger as $$
begin
  if new.winning_team is distinct from old.winning_team then
    new.revision_count = old.revision_count + 1;
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger result_bump_revision
  before update on result
  for each row execute function bump_result_revision();
