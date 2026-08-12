-- 0003_sports_pipeline.sql
-- Sports data ingest pipeline (JAC-20 through JAC-24): lightweight team
-- identity on game, draw support, job-run tracking for cross-run
-- alerting. See docs/adr/0003-sports-data-pipeline.md for the design
-- rationale and docs/sports-pipeline.md for the edge-case behavior spec.

alter table game
  add column home_team_external_id text,
  add column away_team_external_id text,
  add column allows_draw boolean not null default false;

-- Serves score-poll's "games whose start has passed and status isn't
-- final" candidate query — the existing game_sport_starts_at_idx doesn't
-- help there since that query never filters by sport.
create index game_status_starts_at_idx on game(status, starts_at);

-- Rewrites check_pick_selected_team (same trigger, new function body —
-- no drop/recreate of the trigger itself needed) to allow the literal
-- sentinel 'DRAW' as a pick, but only for games where allows_draw is
-- true (soccer). allows_draw is set by the schedule-ingest job based on
-- sport — a single source of truth in application code, not duplicated
-- here as a hardcoded sport-code list.
create or replace function check_pick_selected_team()
returns trigger as $$
declare
  home text;
  away text;
  draw_allowed boolean;
begin
  select home_team, away_team, allows_draw into home, away, draw_allowed
    from game where id = new.game_id;

  if new.selected_team = 'DRAW' then
    if not draw_allowed then
      raise exception 'selected_team DRAW is not allowed for game % (allows_draw is false)', new.game_id;
    end if;
  elsif new.selected_team not in (home, away) then
    raise exception 'selected_team % is not a participant in game %', new.selected_team, new.game_id;
  end if;

  return new;
end;
$$ language plpgsql;

-- Cross-run memory for the schedule-ingest and score-poll cron jobs.
-- A cron-triggered process is short-lived and has no in-memory state
-- between invocations, so "has this job succeeded recently" and "did
-- the last run find anything" need somewhere durable to live — that's
-- this table, written once per run (not inserted-then-updated).
create table job_run (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  succeeded boolean,
  item_count integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index job_run_job_name_started_at_idx on job_run(job_name, started_at desc);
