# Scoring and standings (JAC-37–42)

Scoring is straight-up: one point per correct winner, no spreads, no confidence weighting. Postponed/cancelled games are **voided for everyone** — never counted as a loss. This is the authoritative spec for how grading works, how standings and their tiebreakers are computed, how a wrong result gets corrected, and the API contract for the standings screen. See [`docs/data-model.md`](data-model.md) for the schema and [`docs/api-conventions.md`](api-conventions.md) for error codes. Grading lives in `apps/api/src/lib/grading.ts`; standings computation in `apps/api/src/lib/standings.ts`; routes in `apps/api/src/routes/standings.routes.ts`.

## The grading engine — idempotent by construction

Every pick gets a `outcome` (`'win' | 'loss' | 'void'`) and a `graded_at`, written **once**, at grade time — never re-derived from `result` on every standings read. Standings are read constantly and graded once; the work happens at write time.

Three functions in `lib/grading.ts`, each gated by `WHERE pick.outcome IS NULL`:

- **`gradeFinalGame(gameId, winningTeam, executor)`** — one `UPDATE`, `outcome = case when selected_team = winningTeam then 'win' else 'loss' end`, for every *ungraded* pick on that game.
- **`voidGamePicks(gameId, executor)`** — one `UPDATE`, `outcome = 'void'`, for every ungraded pick on a postponed/cancelled game.
- **`voidGamePicksForGames(gameIds, executor)`** — the bulk variant, used by schedule-ingest's per-sport batch upsert.

The `outcome IS NULL` guard is what makes "grading twice cannot double-count" true — not a lock, not a separate check, just a `WHERE` clause that matches zero rows on the second call. A member who didn't pick a game simply has no `pick` row for it at all, so they score nothing without anything needing to explicitly skip them.

`regradeGame(gameId, winningTeam, executor)` is the one function **without** that guard — it re-grades every `win`/`loss` pick on a game (not just ungraded ones), used only by the result-correction flow below. It never touches an already-`void`ed pick: void is terminal for a given pick (the game was postponed/cancelled when it happened), and a result correction has no bearing on that.

### Golf grades on the opposite rule, deliberately (JAC-56)

`lib/golf-grading.ts`'s `gradeGolfPicks(tournamentId, executor)` has **no** `outcome IS NULL` guard — it behaves like `regradeGame` (always overwrite), not `gradeFinalGame` (grade once). That inversion is the whole point: golf grading is **live**, re-run on every leaderboard poll while the tournament is under way, so a member's outcome legitimately flips from `loss` to `win` (or back) as the leaderboard moves. There is no single "first grading event" to guard against re-running.

A golf pick is a win iff at least one of that member's selected golfers currently sits at `tournament_entry.position <= league.golf_top_n`, read per-league via the `league_member → league` join (the same tournament can be picked across leagues with different settings). A null `position` never counts. `voidTournamentPicks` is the postponed/cancelled equivalent of `voidGamePicks`, and `'void'` stays terminal here too — `gradeGolfPicks` never touches a voided pick.

Golf records merge into the **same** `wins`/`losses`/`gamesParticipated` totals as game picks — `computeStandings` sums `fetchRecords` and `fetchGolfRecords` per member before ranking, so a golf league and a football league produce one unified record, not two parallel ones. The golf query joins **`tournament.ends_at`**, not `starts_at`: standings credit for a multi-day tournament posts entirely on the day it concludes, matching how a game's result posts on the game's own day.

`fetchGolfClusterPicks` feeds the same tiebreaker chain, reusing `ClusterPick.gameId` as an opaque key holding the tournament id. That's safe because every read site uses it only for Set-based "commonly picked" intersection — and usefully means a shared tournament breaks a tie exactly the way a shared game does, with no extra logic.

### The `check_pick_selected_team` trigger bug this surfaced

Grading's `UPDATE pick SET outcome = ...` writes touch every `pick` row on a game — and the pre-existing trigger (`0001_init.sql`) was `BEFORE INSERT OR UPDATE ON pick` with no column qualifier, so it re-validated `selected_team` against `game.home_team`/`away_team` on **every** update, including one that never touches `selected_team` at all. Epic 3 deliberately allows a team's display name to self-correct on re-ingest (`home_team_external_id` is the stable join key); if that correction landed on a game *after* a pick was already made against the old name, grading that pick would crash outright — real, not hypothetical, given the design already in place.

Fixed in `0007_pick_trigger_column_scope.sql` using Postgres's native `UPDATE OF <column>` trigger scoping:

```sql
create trigger pick_check_selected_team
  before insert or update of selected_team on pick
  for each row execute function check_pick_selected_team();
```

`INSERT` still always validates (the column qualifier only applies to the `UPDATE` event); `UPDATE` only re-validates when `selected_team` is itself part of the `SET` clause. Grading's `outcome`/`graded_at`-only writes no longer trip it.

## Voiding postponed/cancelled games — three write paths, one reconciliation sweep

A game can transition to `postponed`/`canceled` from either scheduled job, and the two statuses don't self-heal the same way if a run is missed:

1. **`score-poll.ts`**'s non-final branch calls `voidGamePicks` in the same transaction as the status update, whenever that update actually changes status to postponed/cancelled.
2. **`schedule-ingest.ts`**'s per-sport bulk upsert calls `voidGamePicksForGames` on the just-`.returning()`'d game IDs after each sport's upsert.
3. **Postponed games keep self-healing beyond that**: schedule-ingest's existing unbounded postponed-game recovery pass (Epic 3) means a postponed game keeps reappearing in `.returning()` on every run for as long as it stays postponed — path 2 keeps re-checking it indefinitely.
4. **Cancelled games have no equivalent recovery pass.** Once a cancelled game's date falls outside schedule-ingest's rolling lookback window, it never appears in `.returning()` again — an ungraded pick from a missed run (a crash, a bug) would stay silently ungraded forever. The fix is a small, bounded **reconciliation sweep**, run every score-poll cycle (5-minute cadence):

```sql
select g.id from game g
where g.status in ('postponed', 'canceled')
  and exists (select 1 from pick p where p.game_id = g.id and p.outcome is null)
order by g.starts_at desc
limit 50
```

Cheap and self-healing regardless of which path missed a game: most historical picks are already graded, so this is highly selective once scoped to postponed/cancelled games specifically, and `pick_ungraded_idx` (`pick(game_id) WHERE outcome IS NULL`) serves both the grading writes and this sweep's `EXISTS` check.

## Result correction (JAC-40)

### Automatic detection

Providers do publish corrections after a game goes final — scoring reviews, forfeits, data errors. score-poll gets a second candidate query every run: `final` games where `result.created_at >= now() - REVISION_CHECK_WINDOW_HOURS hours` (env var, default 48). It re-fetches results for those; if the freshly-fetched winner differs from the stored one, in one transaction it updates `result.winning_team` (the existing `bump_result_revision` trigger increments `revision_count`), calls `regradeGame`, and inserts a `result_correction` row (`source: 'provider_revision'`).

**Why `result.created_at`, not `game.updated_at`:** `game.updated_at` is bumped by `set_updated_at` on *any* column change — including schedule-ingest's routine, deliberate team-name corrections on a long-final game (Epic 3's name-drift-correction design). Keying the revision window off it would wrongly reopen the window for reasons that have nothing to do with finalization. `result.created_at` is written exactly once, at insert, by score-poll alone — the correct signal for "how long ago did this actually finalize."

### Manual correction

`POST /:leagueId/games/:gameId/correct-result`, commissioner-only. Body: `{ winningTeam, reason }` — `reason` is required for a manual correction (not for automatic ones), strengthening the audit trail given the blast radius below. Requires the game already has a `result` (this corrects an existing result, not manually grading a game score-poll never touched — a different, unasked-for feature) and that `winningTeam` is a legal selection for the game (one of the two teams, or `'DRAW'` when the game allows it). A no-op correction (`winningTeam` matching the current result) is rejected outright (`400 NO_CHANGE`) rather than recorded.

In one transaction: `UPDATE result.winning_team`, `regradeGame`, insert a `result_correction` row (`source: 'manual'`, `corrected_by_user_id`, `corrected_from_league_id`, `reason`). The response includes every affected member's old→new outcome, computed by snapshotting `pick.outcome` for that game's win/loss picks before regrading and diffing against the same picks after.

### The global-game blast radius — deliberately accepted, not narrowed

`game`/`result` are global (one row shared across every league covering that sport, since Epic 1) — so any commissioner of any league whose `sports` cover this game can correct it, which can affect *other* leagues too, including ones that commissioner has no relationship to. The route does check that the game belongs to the acting commissioner's league's sports (`404 GAME_NOT_FOUND` otherwise) — but that only confirms the game is *relevant* to their league, not that they're the *only* commissioner who could touch it.

No new permission system was built to narrow this: there's no platform-admin role anywhere in this app, and building one is real scope creep beyond this epic's six requirements. A design alternative — gating manual correction behind a fresh provider re-fetch matching the requested value — was considered and rejected: a manual override exists specifically for when the provider is wrong or hasn't caught up, so requiring it to match the provider would defeat its purpose.

The mitigation is full transparency instead: every correction is attributed (who, from which league, when, old→new, and a required reason for manual ones) and queryable by any member of any affected league via `GET /:leagueId/corrections` — not commissioner-only, not hidden, and scoped to games whose sport the requesting league covers (so a correction on a shared game surfaces to every affected league's members, which is the intended behavior, not a leak).

## Week and tiebreaker decisions

Both were explicit "don't guess" asks — confirmed with the user directly before any design work:

- **Week is a fixed Tuesday-to-Monday boundary, for every league, not a per-league setting.** Keeps an NFL slate's Thursday/Sunday/Monday games together in one week. `weekBoundsUtc()` (`apps/api/src/lib/time.ts`) computes it: `daysSinceTuesday = (luxonWeekday - 2 + 7) % 7` (Luxon weekdays run Monday=1..Sunday=7, so Tuesday=2), week start = that day's local midnight minus `daysSinceTuesday` days, week end = start + 7 days (exclusive).
- **Ties are resolved via the full deterministic chain**, not displayed as genuine ties (the simpler, "more honest" alternative was explicitly offered and declined): **win% → head-to-head on commonly-picked games → most recent correct pick → alphabetical by display name → member id** (a fallback that's never actually reachable in practice, but guarantees a strict order). The chain is visible to members, not mysterious — see the standings-screen contract below.

### Why the tiebreaker chain is application code, not one SQL query

"Head-to-head on commonly-picked games" needs a dynamic set intersection across however many members ended up tied — fragile to express as a single SQL expression, and the chain needs to stay legible. `lib/standings.ts`'s `computeStandings`:

1. Runs the base wins/losses/games-participated query, scoped to the timeframe's bounded, indexed set (`pick.league_member_id IN (...)` joined to `game` on `starts_at` range) — not a full table scan as `pick` grows.
2. Sorts by win% descending, clusters adjacent members with identical win% (win% is a single-division float comparison — see the code comment on why that's exact here, not an epsilon-comparison bug).
3. For each cluster with more than one member, fetches that cluster's graded picks and computes the intersection of game IDs *every* member in the cluster picked — "commonly-picked games." Each member's head-to-head win count is their wins restricted to that intersection.
4. Still-tied members resolve by most recent correct pick (`MAX(graded_at) WHERE outcome = 'win'`), recomputed from the same picks already fetched in step 3 — no extra query.
5. Still-tied remainder: alphabetical by display name, then member id.

Steps 1 and 3 run inside one `REPEATABLE READ` transaction — a narrow, scoped exception to the app's default READ COMMITTED (which `lib/pick-write.ts` relies on elsewhere for its own reasons). The base query and the head-to-head follow-up aren't naturally the same snapshot; a pick written or graded concurrently between them could otherwise produce an inconsistent tiebreak.

## The standings-screen API contract

- **`GET /:leagueId/standings?timeframe=today|week|season&date=YYYY-MM-DD`** — member-only. `date` (optional, defaults to today in the league's timezone) is the day the `today`/`week` windows are computed *as of*. Returns each member's `wins`, `losses`, `gamesParticipated`, `winPct`, `rank`, and `rankChange`. `rankChange` diffs the current period's rank against the immediately prior period of the same length (yesterday for `today`, the previous Tuesday–Monday week for `week`) — `null` for `season`, which has no natural prior period, and `null` for a member who wasn't ranked in the prior period at all (e.g. joined since). `callerLeagueMemberId` is included so a client can pin the caller's own row without a second lookup.
- **`GET /:leagueId/head-to-head?date=YYYY-MM-DD`** — member-only. Only **locked** games for that date appear at all — an unlocked game is omitted entirely, not just its picks hidden, since comparing an in-progress slate isn't the point of this view (the same visibility rule Epic 5 established for the slate endpoint). Per game: teams, `winningTeam` (`null` if not yet graded), and `picks: [{ leagueMemberId, displayName, selectedTeam, hit }]` (`hit` is `null` until graded), plus server-computed `split` (the picked selections weren't unanimous) and `allWrong` (graded, and nobody's pick — among those who picked — matched the winner). Computed server-side, same philosophy as the slate endpoint's `pickState`: a client never re-derives the rule that makes a game interesting.
- **"Tap a member to see their picks for any locked slate"** doesn't need a new endpoint. The existing Epic 5 slate endpoint's `otherPicks` already reveals every other member's selection once a game is locked; a client filters that response by `leagueMemberId`. Nothing new to build here.
- **Live updates** are a client polling/re-fetch-on-an-interval concern, same as the slate endpoint — both `computeStandings` and the head-to-head query are computed fresh on every request, so re-requesting near when results land reflects them immediately. No server-push mechanism is built in this epic.
- **`POST /:leagueId/games/:gameId/correct-result`** and **`GET /:leagueId/corrections`** — see Result correction above.

## An engineering note: raw `db.execute()` and timestamp columns

Confirmed empirically while building the tiebreaker chain: `db.execute(sql\`...\`)`'s raw path returns `timestamptz` columns as Postgres's text representation (e.g. `"2026-08-13 00:58:11.252885+00"`), **not** a JS `Date` — unlike Drizzle's typed query builder (`db.select()`), which maps columns using schema type info. A generic type annotation on `db.execute<{...}>()` doesn't make this true at runtime; it only silences the type checker. Every raw-execute call in this codebase that needs `Date` arithmetic or ISO-8601 serialization on a timestamp column now converts explicitly (`new Date(row.some_timestamp)`) before using it — see `lib/standings.ts`'s `fetchClusterPicks` and `standings.routes.ts`'s head-to-head query for the pattern. This joins the standing list of raw-SQL assumptions this codebase checks against real Postgres before trusting them (CTE array-flattening, bigint-as-string, cursor sub-millisecond precision, nested-transaction savepoints) rather than reasoning about them from documentation alone.
