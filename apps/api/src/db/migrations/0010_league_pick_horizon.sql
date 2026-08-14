-- 0010_league_pick_horizon.sql
-- Per-league pick horizon: how many days ahead a member can see a game
-- as pickable. Bounds both the home screen's `unpickedCount` (previously
-- unbounded — every future ingested game counted, however far out) and
-- the actual pick-write enforcement in lib/pick-write.ts. Commissioner-
-- configurable via PATCH /:leagueId. Default of 7 (a week) meaningfully
-- tightens the old unbounded behavior without being a jarring drop for
-- existing leagues; the check caps it at 30 so a league can't
-- accidentally recreate the old effectively-unbounded behavior.

alter table league
  add column pick_horizon_days integer not null default 7;

alter table league
  add constraint league_pick_horizon_days_check check (pick_horizon_days between 1 and 30);
