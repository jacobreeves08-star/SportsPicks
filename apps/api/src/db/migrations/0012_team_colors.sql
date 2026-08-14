-- 0012_team_colors.sql
-- Team primary colors, sourced directly from ESPN's own scoreboard
-- response (`competitor.team.color`, confirmed against the live API
-- alongside `team.logo` — a 6-digit hex string with no leading '#',
-- e.g. "0e3386"). Nullable, same as the logo URL columns: unset for
-- manually-entered games, and re-ingest self-corrects a missing or
-- stale value via the same external_id upsert path.

alter table game
  add column home_team_color text,
  add column away_team_color text;
