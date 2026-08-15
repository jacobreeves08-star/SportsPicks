-- 0014_athlete_country_flags.sql
-- Country flags for individual-sport competitors. ESPN's scoreboard
-- gives an athlete competitor an `athlete.flag` object
-- (`{ href, alt, rel: ["country-flag"] }`, confirmed against the live
-- API for mma/ufc, golf/pga and tennis/atp) where a team competitor
-- instead gets `team.logo`. The two are mutually exclusive in practice:
-- an athlete has no crest, a franchise has no nationality, and no
-- tracked sport has ever returned both on one competitor.
--
-- Kept as SEPARATE columns rather than writing flag URLs into the
-- existing *_logo_url columns: those are documented as ESPN's
-- `team.logo` (a per-franchise crest), and a flag is a different kind
-- of image with a different fallback story. Collapsing them would also
-- make it impossible to tell "this individual sport has no flag yet"
-- apart from "this team's crest failed to ingest". The client picks
-- logo-then-flag at render time; the database keeps them distinct.

alter table game
  add column home_team_flag_url text,
  add column away_team_flag_url text;

-- Golf's field lives in its own table (a tournament has ~69
-- competitors, not two sides), so it needs the same column there. Every
-- golf competitor is an athlete, so this is the ONLY image a golfer
-- will ever have — there is no logo column here to fall back from.
alter table tournament_entry
  add column flag_url text;
