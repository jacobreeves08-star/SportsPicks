-- 0011_team_logo_urls.sql
-- Team logo URLs, sourced directly from ESPN's own scoreboard response
-- (`competitor.team.logo`, confirmed against the live API — a stable
-- per-franchise CDN URL, e.g. https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/chc.png).
-- Nullable, same as home_team_external_id/away_team_external_id: unset
-- for manually-entered games, and re-ingest self-corrects a missing or
-- stale URL via the same external_id upsert path.

alter table game
  add column home_team_logo_url text,
  add column away_team_logo_url text;
