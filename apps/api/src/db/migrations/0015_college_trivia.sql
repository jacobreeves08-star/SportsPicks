-- 0015_college_trivia.sql
-- "Which college did this player attend?" — a daily 5-question trivia
-- round, playable logged-out (nothing persisted) or logged-in (tracked
-- against the profile). See docs/college-trivia.md.
--
-- Deliberately its own set of tables rather than any reuse of
-- game/pick or tournament/golf_pick: this isn't a pick at all. It has
-- no league, no member, no lock time, no standings credit, and it is
-- graded instantly against a fact rather than against a future result.
-- The ONLY thing it shares with the rest of the app is the ESPN
-- provider posture (lib/nfl-athlete-provider.ts) and the ingest-job
-- shape (jobs/nfl-athlete-ingest.ts).

-- The player pool the daily questions are drawn from. One row per NFL
-- athlete who HAS a college on ESPN's roster response — an athlete
-- without one (confirmed live: a handful of International Player
-- Pathway players carry no `college` object at all) is skipped at
-- ingest rather than stored with a null, because a college-trivia
-- question about a player with no college is unanswerable by
-- construction, not merely incomplete.
create table nfl_athlete (
  id uuid primary key default gen_random_uuid(),
  -- ESPN's athlete id, for idempotent re-ingest. Not nullable (unlike
  -- game.external_id / tournament.external_id, which allow a manually
  -- entered row) — there is no manual-entry path for the player pool.
  external_id text not null unique,
  display_name text not null,
  -- ESPN's `position.abbreviation` (QB/RB/WR/...). Feeds question
  -- selection: a quarterback is far more recognizable than a practice-
  -- squad long snapper, and a quiz nobody can answer isn't fun. See
  -- lib/trivia-puzzle.ts's SKILL_POSITIONS.
  position_abbreviation text,
  jersey text,
  headshot_url text,
  -- The athlete's CURRENT team, denormalized rather than referencing
  -- the `game`/team data: this pool is ingested from the roster
  -- endpoint, which has no relationship at all to the scoreboard rows
  -- schedule-ingest writes, and there is no team table to point at.
  team_external_id text,
  team_display_name text,
  -- The answer. `college_name` is ESPN's `college.name` ("Cincinnati",
  -- "Ohio State") — the short form a person would actually say out
  -- loud, not the mascot or the abbreviation.
  college_name text not null,
  college_external_id text,
  college_logo_url text,
  -- Which roster group ESPN listed the athlete under, normalized:
  -- 'active' | 'practice_squad' | 'injured_reserve'. Question
  -- selection prefers 'active' — see lib/trivia-puzzle.ts.
  roster_status text not null default 'active',
  -- ESPN's `experience.years` (0 for a rookie). A second, weaker
  -- recognizability signal alongside position.
  experience_years integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfl_athlete_roster_status_check
    check (roster_status in ('active', 'practice_squad', 'injured_reserve'))
);

-- Serves the puzzle builder's candidate query (active skill-position
-- players first) and the distractor pool query.
create index nfl_athlete_roster_status_position_idx
  on nfl_athlete (roster_status, position_abbreviation);
create index nfl_athlete_college_name_idx on nfl_athlete (college_name);

-- One row per calendar day. The SAME five players for everybody, the
-- same day, worldwide — that's what makes a shared score ("4/5")
-- comparable between two friends instead of meaningless. The day
-- boundary is a single fixed anchor timezone (America/New_York, the
-- NFL's own), NOT the caller's timezone and NOT a league's: a
-- per-viewer day would hand two friends different players at the same
-- instant and quietly break the comparison the sharing feature exists
-- for. See lib/trivia-puzzle.ts.
create table trivia_puzzle (
  id uuid primary key default gen_random_uuid(),
  puzzle_date date not null unique,
  -- Human-facing day index ("College Quiz #12"), the stable identifier
  -- a shared result is labelled with. Stored rather than computed from
  -- puzzle_date at read time so that changing the epoch later can
  -- never renumber a puzzle somebody already shared.
  puzzle_number integer not null unique,
  created_at timestamptz not null default now()
);

-- The five questions of one puzzle, in fixed display order.
create table trivia_question (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references trivia_puzzle (id) on delete cascade,
  -- 1..5, the order they're asked in — "back to back to back to back
  -- to back" is a single ordered run, not five independent prompts.
  position integer not null,
  athlete_id uuid not null references nfl_athlete (id),
  -- The five college names as displayed, already shuffled and frozen
  -- at build time. Frozen rather than shuffled per-request for two
  -- reasons: every player sees an identical board (again, so a shared
  -- score compares), and `answer_index` below stays meaningful.
  options text[] not null,
  -- 0-based index into `options`. This column is the reason grading is
  -- a server round trip: it is NEVER included in any response body, so
  -- the answers cannot be read out of the network tab or the client
  -- bundle before the user has picked. See routes/trivia.routes.ts.
  answer_index integer not null,
  constraint trivia_question_position_check check (position between 1 and 5),
  constraint trivia_question_options_length_check check (array_length(options, 1) = 5),
  constraint trivia_question_answer_index_check check (answer_index between 0 and 4),
  unique (puzzle_id, position)
);

create index trivia_question_puzzle_id_idx on trivia_question (puzzle_id);

-- One row per logged-in user per puzzle — "one activation of the
-- feature per day" enforced server-side by this unique constraint, not
-- by the client. A logged-out visitor has no row here at all and is
-- gated only by their own browser (localStorage), which is honestly
-- not enforcement; see docs/college-trivia.md.
create table trivia_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user" (id),
  puzzle_id uuid not null references trivia_puzzle (id),
  -- Running tallies, maintained as answers land, so the stats queries
  -- never have to aggregate trivia_answer across a user's whole
  -- history. answered_count reaching 5 is what sets completed_at.
  correct_count integer not null default 0,
  answered_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trivia_attempt_correct_count_check check (correct_count between 0 and 5),
  constraint trivia_attempt_answered_count_check check (answered_count between 0 and 5),
  constraint trivia_attempt_correct_lte_answered_check check (correct_count <= answered_count),
  unique (user_id, puzzle_id)
);

-- Serves the profile stats query (a user's attempts, newest first) —
-- it joins to trivia_puzzle for the date, so puzzle_id is the useful
-- half of the pair here.
create index trivia_attempt_user_id_idx on trivia_attempt (user_id);

-- One row per question answered within an attempt. Append-only in
-- practice: the route refuses to overwrite an existing row (a second
-- POST for the same question returns the stored answer unchanged),
-- which is what makes "you get one shot per player, per day" true
-- rather than merely unenforced.
create table trivia_answer (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references trivia_attempt (id) on delete cascade,
  question_id uuid not null references trivia_question (id),
  selected_index integer not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  constraint trivia_answer_selected_index_check check (selected_index between 0 and 4),
  unique (attempt_id, question_id)
);

create index trivia_answer_attempt_id_idx on trivia_answer (attempt_id);
