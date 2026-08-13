-- 0007_pick_trigger_column_scope.sql
-- Bug fix, discovered live while wiring up grading (JAC-37-42): the
-- pick_check_selected_team trigger (0001_init.sql) was defined as
-- `before insert or update on pick` with no column qualifier, so it
-- re-validated selected_team against game.home_team/away_team on EVERY
-- update to a pick row — including grading's own `set outcome = ...`,
-- which never touches selected_team at all.
--
-- This wasn't just an unlikely edge case: Epic 3's team-identity design
-- deliberately corrects a team's stored display name on re-ingest when
-- ESPN's name for a franchise drifts (see home_team_external_id /
-- away_team_external_id in docs/adr/0003-sports-data-pipeline.md). If
-- that correction landed on a game AFTER a pick was already made
-- against the OLD name, grading that pick would crash outright —
-- discovered via a real integration test, not by inspection.
--
-- Fix: scope the UPDATE half of the trigger to fire only when
-- selected_team itself is part of the SET clause. `... OR UPDATE OF
-- selected_team` only qualifies the UPDATE event — INSERT is
-- unaffected and still validates every new pick, same as before.
drop trigger pick_check_selected_team on pick;

create trigger pick_check_selected_team
  before insert or update of selected_team on pick
  for each row execute function check_pick_selected_team();
