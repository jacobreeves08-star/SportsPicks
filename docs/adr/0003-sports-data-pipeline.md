# ADR 0003: Sports data pipeline — provider choice and ingest/poll design

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Epic 3 (JAC-19–24) is the highest-risk part of the product: a wrong start time lets someone pick a game already in progress, and a missed final silently freezes standings for an entire league. Scope is NFL, NCAA football, NBA, NCAA men's basketball, MLB, and three soccer competitions (Premier League, Champions League, MLS) — 8 distinct competitions once soccer is unbundled by competition rather than treated as one "soccer" sport. (NHL was added later, in a subsequent session — see the "NHL added" note under Provider evaluation below; still 8 competitions at the time this scope was originally decided.)

## Provider evaluation (JAC-19)

Before any code was written, three commercial providers were compared on college coverage, start-time accuracy, final-result latency, pricing, rate limits, and licensing for team names/marks:

| | SportsDataIO | Sportradar | API-Sports |
|---|---|---|---|
| College football/basketball coverage | Full | Full, enterprise-tier pricing | Full |
| Pricing | Mid-tier plans with per-sport add-ons | Custom/enterprise, no self-serve tier | Cheapest self-serve tier |
| Rate limits | Documented, generous on paid tiers | Documented, generous | Documented, tighter on free tier |
| Licensing | Standard commercial terms for team names/marks | Standard commercial terms | Standard commercial terms |

The lean recommendation was API-Sports for its cost/self-serve fit. That evaluation was presented and the decision was deliberately left to the maintainer — no contract exists yet for any of these three, and none was ever set up in this repo.

**Decision actually made:** use ESPN's undocumented `site.api.espn.com` site API instead of any of the three evaluated commercial providers. This overrides the JAC-19 recommendation. It is free, unauthenticated, and requires no account, contract, or DNS setup — a real advantage for a low-ops, solo-maintainer project (the same framing as [ADR 0001](0001-stack-selection.md)) — at the cost of no published SLA, no published rate limit, and no support channel if the response shape changes without notice.

**Verified against real live requests this session** (not guessed, not taken from third-party documentation of the endpoint since none is official):

- `https://site.api.espn.com/apis/site/v2/sports/{espnSport}/{espnLeague}/scoreboard?dates={YYYYMMDD}` or `?dates={YYYYMMDD-YYYYMMDD}` — date ranges confirmed working in one call, returning multiple distinct days.
- 8 sport/league slug pairs, all confirmed live: `nfl`, `ncaaf`, `nba`, `ncaamb`, `mlb`, `epl`, `ucl`, `mls` (`apps/api/src/lib/sports-provider.ts`'s `ESPN_SPORT_SLUGS`).
- **NHL added** in a later session: `hockey/nhl` confirmed structurally identical to the other team sports (exactly 2 competitors per event, each with `homeAway` + a `team` object) — a genuine drop-in. The same session also checked golf (`golf/pga`), tennis (`tennis/atp`), and MMA (`mma/ufc`) and found none of them fit this adapter without real rework: golf is a ~69-competitor leaderboard with no home/away concept at all; tennis nests actual matches under `event.groupings[].competitions[]` (an "event" is a ~2-week tournament, not a single match) and uses `athlete` instead of `team`; MMA has multiple fights per event with competitors carrying `order`/`winner` but no `homeAway` field at all. `ESPN_SPORT_SLUGS` was 9 entries as of this addition.
- **Tennis and MMA added** in a still-later session, once the product decision was made (match/fight-by-match, no round or tier distinction): the adapter gained a `matchStyle` per sport (`"team"` / `"individual-flat"` / `"individual-grouped"`) and now extracts real MATCHES from each raw event before mapping, rather than assuming `event.competitions[0]` is the whole story. `tennis/atp`'s scoreboard already includes BOTH tours for a combined event week (confirmed live: `tennis/atp` and `tennis/wta` return the identical tournament with both Men's and Women's groupings on either slug), so only `atp` is queried and the app-level code is the gender-neutral `tennis`; doubles groupings are excluded (a doubles "competitor" is a pair, not a single participant — out of scope). MMA's `mma/ufc` events are a whole fight card; every fight in `event.competitions[]` becomes its own entry, using that fight's own `id`/`date` (a card's fights don't share one start time) and synthesizing home/away from `order` since MMA competitors have no `homeAway` field at all. Golf remains out of scope — it needs a genuinely different pick mechanic (a member selects several golfers before the tournament, graded against final leaderboard position), not just a reshaped 2-competitor matchup. `ESPN_SPORT_SLUGS` is 11 entries as of this addition.
- `status.type.completed` (boolean) is the only authoritative finality signal, and it generalizes across every sport. `status.type.name` varies by sport for the same real-world state — `STATUS_FINAL` (NFL/MLB/NCAAF), `STATUS_FULL_TIME` (soccer regular play), `STATUS_FINAL_PEN` (soccer decided on penalties) all confirmed live for the same underlying "the game is over" state. Never string-match `name` to decide finality.
- `competitor.winner` is a boolean, and ESPN itself resolves shootout winners (confirmed live: PSG 1-1 Arsenal through 90+ minutes, PSG `winner: true` after penalties, `STATUS_FINAL_PEN`). A genuine draw is `completed === true` with every competitor's `winner === false` (confirmed live: Nottingham Forest 1-1 Aston Villa, regular EPL play).
- `competitor.winner` is **absent**, not `false`, on pre-game competitors — discovered when a real captured `scheduled.json` fixture failed an initial zod schema that required the field; the schema was corrected to `z.boolean().optional()` to match observed reality rather than adjusting the fixture to match a wrong assumption.
- A per-event `summary?event={id}` endpoint exists but returns 500KB+ (box score, play-by-play, odds, news) versus a few KB for the scoreboard — decisively worse for polling many live games. Never used; `fetchResults` always hits the compact scoreboard endpoint, grouped by (sport, date).
- No published rate limit. Mitigated by conservative call volume by design: `schedule-ingest` runs every 4 hours (not more often) and issues one call per sport per run (11 calls/run, plus a small number of targeted re-fetches for postponed games); `score-poll` runs every 5 minutes but only fetches games whose start has already passed and whose status isn't final, so a quiet stretch with nothing live costs zero calls.

## Decisions

### Canonical adapter boundary — no ESPN field name crosses it

`apps/api/src/lib/sports-provider.ts` defines `CanonicalGameStatus`, `CanonicalTeam`, `CanonicalScheduleEntry`, and `CanonicalResult`, and every consumer (`schedule-ingest.ts`, `score-poll.ts`) only ever sees these types. If ESPN is ever replaced (with one of the three evaluated commercial providers, or anything else), only this one file needs to change — the two job files and the schema are already provider-agnostic. `toCanonicalStatus()` has exactly one path to `"final"` (`completed === true`), which is what makes invariant #6 ("never treat an in-progress score as final regardless of how lopsided it is") structurally enforced rather than merely documented — a lopsided-but-not-completed game cannot become `"final"` no matter what its score looks like, because score is never read by the mapping function at all.

### Draws are a real third pick option, not voided

Confirmed with the user directly (not guessed): soccer draws get a `'DRAW'` sentinel accepted by `pick.selected_team` (gated by a new `game.allows_draw` column, true only for the three soccer competitions) and written by `result.winning_team` on a level final. This keeps grading uniform (`pick.selected_team === result.winning_team`, no special-casing) at the cost of expanding scope into the pick-validation trigger, which was accepted as worth it for a straightforward equality check in grading later. See §Edge cases in `docs/sports-pipeline.md`.

### Team identity stays lightweight — no `team` table

Confirmed with the user directly. `game.home_team`/`away_team` remain plain text (unchanged from `docs/data-model.md`); two new nullable columns, `home_team_external_id`/`away_team_external_id`, store ESPN's stable per-franchise ID. This gives `schedule-ingest` a stable join key so a name correction (rebrand, ESPN display-name change) on re-ingest still finds and updates the same row via `external_id`/team ID, without introducing a full normalized team entity or touching pick-ownership semantics.

### Exactly-once finalization via a conditional UPDATE, not application-level locking

A game only transitions to `final` via `UPDATE game SET status='final' WHERE id=? AND status != 'final'`, and the accompanying `result` row is written in the *same* database transaction (`score-poll.ts`). If the conditional update affects zero rows, that's a guaranteed no-op — a second poll of an already-final game, a slow retry, or a re-run after a crash can never produce a duplicate `result` row or a second processing pass. This was chosen over an application-level "check then write" because that pattern has a race window between the check and the write; the conditional `UPDATE ... WHERE` makes the database itself the single point of truth for "did this transition actually happen," atomically.

### Single-writer boundary: schedule-ingest can never downgrade a final game

**The most consequential fix in this epic, caught during my own plan review before any code was written — not discovered through a bug in production or in testing.** The initial design considered a blanket application-level rule: "if `schedule-ingest` computes a game's status as final, write `in_progress` instead, since only `score-poll` should ever finalize a game." That rule looks safe in isolation but is actually broken in an everyday way: `schedule-ingest`'s regular per-sport window includes a 1-day lookback margin (`LOOKBACK_DAYS`, needed for a separate reason below), so it re-scans every game finished in roughly the last day on *every single 4-hourly run* — not a rare edge case. An application-level clamp applied at read-time would silently revert a game `score-poll` had already, correctly finalized, back to `in_progress`, every time `schedule-ingest` happened to re-scan it within that window.

The fix lives at the database write itself, not the application layer: the upsert's `SET` clause for `status` is a SQL `CASE` expression —

```sql
status: case when game.status = 'final' then game.status else excluded.status end
```

— so `schedule-ingest` is structurally incapable of overwriting a final game's status no matter what it computes, enforced at the row level rather than by convention or by hoping every future call site remembers the rule. `score-poll` is the only writer that can ever set `status = 'final'` or write a `result` row. Covered by a dedicated integration test (`schedule-ingest.test.ts`) that seeds a final game with a result directly, runs `schedule-ingest` with a canned entry that would otherwise re-finalize it, and asserts both the status and the result row (including `revision_count`) are untouched.

### `LOOKBACK_DAYS` exists for ESPN's date-bucketing, not for re-checking finals

The 1-day lookback margin on `schedule-ingest`'s regular window is there because ESPN's `dates=` query buckets by a date that isn't guaranteed to match the UTC calendar day of a late-night US game's `event.date` — querying only the exact date risks silently missing a game. `fetchResults` (score-poll's read path) has the same class of problem and is fixed the same way: it queries a 3-day range (`date-1` to `date+1`) around each candidate's own start date, at no extra API-call cost since it's still one grouped call per sport+date combination, then filters to the requested IDs.

### Postponement recovery via a targeted, unbounded re-fetch

A naive forward-only rolling window (today−1 to today+14) would never re-check a postponed game once its original scheduled date falls out of that window — a game postponed today and rescheduled six weeks later would be permanently stuck at `status = 'postponed'`. Fixed by having `schedule-ingest` separately query, every run, every currently-postponed game's own original date via `fetchSchedule({ sport, fromDate: thatDate, toDate: thatDate })`, unbounded by how far in the past that date now is. Because the upsert keys on the stable `external_id`, a rescheduled game found this way updates the *same* `game.id` — any existing pick against it survives with its `game_id` unchanged, which is what makes "picks carry to new date" true without any pick-table code at all.

**Documented known gap:** if ESPN ever issues a genuinely new event ID for a makeup date rather than reusing the original, this system won't auto-reconcile that — it would appear as a second, separate game with no picks against it. No automatic heuristic reconciliation (e.g., fuzzy-matching two events by teams and a nearby date) was attempted, since a real risk of false-positive mismatches (two different meetings between the same two teams within a season) outweighs the benefit; this is a documented limitation, not something solved by guessing.

### Retry + a per-run circuit breaker, not a persistent one

`apps/api/src/lib/retry.ts`'s `withRetry` retries network errors and 5xx/429 with exponential backoff and jitter, and never retries other 4xx (a client error won't fix itself on retry). `EspnSportsProvider` owns a small circuit breaker on top of that: 3 consecutive retry-exhausted failures trips it for the rest of that run. It is deliberately a **fresh instance per job invocation**, not a persistent, cross-run circuit breaker — each cron run is a new process, so there's no long-running service instance for a classic sustained-load circuit breaker to protect. Tripping it fails the current run fast (rather than burning the run's whole time budget retrying every remaining call), and the next cron tick starts clean with a fresh breaker. Building a persistent breaker that pretends there's sustained load to protect against would be complexity with no real benefit in a short-lived-process model.

### `job_run` table: cross-run memory for a stateless process

A cron-triggered process has no in-memory state between invocations, but this epic's alerting needs to answer "has the schedule-ingest job succeeded recently?" from outside any single run. `job_run` (`apps/api/src/db/schema.ts`) is a plain append-only log — one row written once per run, at the end (success or caught failure), read by `getJobRunStatus()` (`apps/api/src/lib/job-run.ts`) and exposed via `GET /health/data-freshness`.

### A third alerting channel: `captureMessage` for "succeeded but suspicious," not just "failed"

Per the explicit requirement to alert on unexpected emptiness, not just errors: the dangerous failure mode is the provider returning `200` with an empty array, the job "succeeding," and nobody noticing until league members ask why standings stopped moving. `captureMessage()` (new in `apps/api/src/lib/error-tracking.ts`, alongside the existing `captureException`) reports a `job_run` with `succeeded: true` but a suspicious signal: `schedule-ingest` calls it when all 8 sports return zero games in one run (a per-sport zero is often legitimate — e.g. NBA in August — but all-sports-zero simultaneously is not, given this app's combined near-year-round coverage); `score-poll` calls it when `findStaleGames()` (`apps/api/src/lib/game-staleness.ts`, shared with the health endpoint) finds games past their sport's expected maximum duration still without a final result. Neither call fails the run — the job genuinely did succeed; something about the *data* looks wrong, which is a distinct signal from an error tracker's "the code threw."

## Consequences

- No contract, no SLA, no support channel — if ESPN changes or removes this undocumented endpoint, there's no vendor to escalate to. The canonical adapter boundary (above) means a provider swap only touches one file, which is the main mitigation available for this risk.
- Zero ongoing cost and zero account/DNS setup, unlike all three commercial providers evaluated under JAC-19 — see `docs/environments.md`.
- The single-writer boundary and the lookback-margin interaction it protects against is subtle enough that it's worth re-reading this ADR (not just the code) before ever touching `schedule-ingest`'s upsert logic again.
