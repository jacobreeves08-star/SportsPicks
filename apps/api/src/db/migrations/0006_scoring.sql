-- 0006_scoring.sql
-- Scoring and standings (JAC-37 through JAC-42): per-pick graded outcome
-- (stored, not recomputed on every standings read) and an audit trail
-- of result corrections. See docs/scoring-and-standings.md for the
-- full design rationale.

alter table pick
  add column outcome text check (outcome in ('win', 'loss', 'void')),
  add column graded_at timestamptz;

-- Serves both grading writes (idempotent via this same WHERE condition
-- — grading twice matches zero rows the second time) and the
-- reconciliation sweep in score-poll.ts: most historical picks ARE
-- graded, so outcome-is-null is highly selective once scoped to a
-- specific game or a small set of postponed/cancelled games.
create index pick_ungraded_idx on pick(game_id) where outcome is null;

-- "Notify affected members that their record changed and why" (JAC-40)
-- — no notification DELIVERY system exists (Epic 7 doesn't exist yet),
-- so this is the same documented-queryable-record pattern already used
-- for league_member_report: a correction endpoint's response includes
-- the affected members directly, and this table keeps the history
-- queryable after the fact for any member, not just the commissioner.
create table result_correction (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references game(id),
  old_winning_team text not null,
  new_winning_team text not null,
  source text not null check (source in ('provider_revision', 'manual')),
  -- Both null for an automatic provider-revision correction; set for a
  -- manual one, so a correction that reaches across leagues (game/result
  -- are global — see docs/scoring-and-standings.md) is fully attributed.
  corrected_by_user_id uuid references "user"(id),
  corrected_from_league_id uuid references league(id),
  reason text,
  created_at timestamptz not null default now()
);

create index result_correction_game_id_idx on result_correction(game_id);
