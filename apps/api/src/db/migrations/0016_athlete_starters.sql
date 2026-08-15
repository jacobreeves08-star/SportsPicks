-- 0016_athlete_starters.sql
-- Depth-chart starter flag for the college quiz's player pool.
--
-- The quiz's original "recognizability" proxy — active roster + skill
-- position — treated a third-string running back and a franchise
-- quarterback as equally quiz-worthy, and players nobody outside one
-- fanbase has heard of kept showing up. Being listed FIRST in a slot
-- of ESPN's per-team depth chart is the signal that actually matches
-- "a casual fan has heard of this player": the starting QB/RB/WR/TE of
-- every team is close to the definition of a household name. Question
-- selection now prefers starters at those positions before anything
-- else — see lib/trivia-puzzle.ts.
--
-- A plain boolean rather than a depth rank: the puzzle builder only
-- ever asks "starter or not", and a rank would imply an ordering
-- ESPN's slot-shaped chart (wr1/wr2/wr3 are separate slots, each with
-- its own #1) doesn't really carry.
alter table nfl_athlete
  add column is_starter boolean not null default false;
