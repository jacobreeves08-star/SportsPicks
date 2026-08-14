# Sports data pipeline (JAC-19–24)

This is the authoritative spec for how games move through the pipeline and what happens in every edge case. See [`docs/adr/0003-sports-data-pipeline.md`](adr/0003-sports-data-pipeline.md) for why the design looks like this; this document is the behavior reference — what actually happens for a given real-world situation, and (where relevant) suggested user-facing copy.

## The jobs

| Job | Schedule | Purpose | Heartbeat env var |
|---|---|---|---|
| `schedule-ingest` (`apps/api/src/jobs/schedule-ingest.ts`) | Every 4 hours (`0 */4 * * *`) | Upserts the schedule (teams, start times, non-final status) for a rolling window, plus a targeted re-fetch of postponed games | `SCHEDULE_INGEST_HEARTBEAT_URL` |
| `score-poll` (`apps/api/src/jobs/score-poll.ts`) | Every 5 minutes (`*/5 * * * *`) | Polls only games whose start has passed and aren't final yet; writes the `result` row on the transition to final | `HEARTBEAT_URL` |
| `golf-ingest` (`apps/api/src/jobs/golf-ingest.ts`) | Every 15 minutes (`*/15 * * * *`) | Golf only — discovery, leaderboard polling, AND grading in one job (see the golf section below) | `GOLF_INGEST_HEARTBEAT_URL` |

`schedule-ingest` can update a game's non-final status, start time, and team names; only `score-poll` can ever set `status = 'final'` or write a `result` row. See ADR 0003's "single-writer boundary" section for why that split is enforced at the database level, not just by convention.

Golf sits entirely outside that pair — different tables, different job, different grading rules. See "Golf" below.

## Edge case behavior matrix

### Postponed

- `game.status` becomes `'postponed'`.
- Picks are unaffected — they reference the stable `game.id`, never a date, so nothing needs to move.
- Every `schedule-ingest` run separately re-fetches every currently-postponed game's own original date (unbounded by the normal 14-day forward window), so once ESPN publishes a real new date, it's picked up on the next run and the *same* `game.id` gets a new `starts_at` — existing picks against it carry over automatically.
- **Known gap:** if ESPN ever issues a brand-new event ID for the makeup date instead of reusing the original, this system will not auto-merge the two — the makeup date shows up as a second, unrelated game with no picks against it. Not auto-reconciled by design (see ADR 0003) — would need manual intervention (a commissioner tool to migrate picks between two `game` rows) if it ever actually happens; no such tool exists yet.
- Suggested user-facing copy: *"This game has been postponed. We'll update the schedule once a new time is announced — your pick will carry over automatically."*

### Cancelled

- `game.status` becomes `'canceled'`. Terminal — a cancelled game never becomes anything else.
- No `result` row is ever written for a cancelled game.
- No penalty: a future grading pass checks `game.status` and skips cancelled games entirely, so a pick against a cancelled game neither counts as a win nor a loss.
- Suggested user-facing copy: *"This game was cancelled and won't count toward your record."*

### Suspended / resumed

- No dedicated `game.status` value exists for "suspended" — ESPN's `STATUS_SUSPENDED` maps to the same canonical `'postponed'` as an actual postponement, since "wait, don't grade yet" is the correct behavior either way.
- A suspended-then-resumed match simply continues to be polled by `score-poll` (it's still not `'final'`) until ESPN itself reports `status.type.completed === true`, at which point it finalizes normally.
- ESPN's `wasSuspended` boolean (marking that a match *experienced* a suspension at some point) is logged, not persisted — it has no bearing on current state once the match is actually final.
- Never graded until genuinely final: this falls directly out of `toCanonicalStatus()` having exactly one path to `'final'` (`completed === true`), so a suspended match's in-progress score, however lopsided, cannot trigger a premature grade.

### Start time moved (earlier or later)

- No special-casing needed. Any change to `starts_at` on a schedule-ingest re-fetch is just written as part of the ordinary upsert.
- **Lock enforcement moves with it automatically**, because pick-lock logic (wherever it's implemented, in the future picks feature) reads `game.starts_at` live rather than caching a lock time — a start time pulled earlier immediately tightens the lock window; pulled later, it loosens it. No separate propagation step exists or is needed.

### Draw (soccer only)

- Confirmed with the user directly: draws get a real third pick option, not a void.
- `game.allows_draw` is `true` only for the three soccer competitions (`epl`, `ucl`, `mls` — see `ESPN_SPORT_SLUGS` in `apps/api/src/lib/sports-provider.ts`); `false` for every other tracked sport, including the individual ones (tennis, MMA) — a match/fight always has a winner.
- The pick-validation trigger (`check_pick_selected_team`, `apps/api/src/db/migrations/0003_sports_pipeline.sql`) accepts `selected_team = 'DRAW'` only when the referenced game's `allows_draw` is true — a `'DRAW'` pick against an NFL game is rejected at the database level, not just in application code.
- On a level final, `result.winning_team` is written as the same `'DRAW'` sentinel, so grading logic stays uniform (`pick.selected_team === result.winning_team`, no special-casing for soccer versus everything else).
- **A genuine non-soccer tie** (rare but real — e.g. an NFL game tied after overtime) is handled by the same mechanism "by accident": `result.winning_team` becomes `'DRAW'` even though no pick could ever legally hold that value for a non-draw-eligible game. Grading later correctly finds nobody's pick right for that game. This is intentional, not an oversight — documented here so it isn't mistaken for a bug later.
- Suggested user-facing copy (pick UI, soccer games only): a visible third option alongside the two team names, labeled `"Draw"`.

### Never treat an in-progress score as final

- Structurally enforced, not just documented: `toCanonicalStatus()` has exactly one branch that returns `'final'`, gated on ESPN's `status.type.completed` boolean. Score, clock, and period are never read by that function at all — a 42-point blowout with `completed: false` cannot produce `'final'` no matter what the numbers say.
- Covered by a dedicated fixture (`apps/api/src/lib/__fixtures__/espn/lopsided-not-final.json`) and test in both `sports-provider.test.ts` (adapter level) and `score-poll.test.ts` (job level).

## Golf (JAC-56)

Golf does not fit the `game`/`pick` model at all and was deliberately not force-fit into it. A PGA event has ~69 `athlete` competitors sharing **one leaderboard** — there is no home/away, no two-sided matchup, and nothing for `PickControl` to render. Verified live against `site.api.espn.com/.../golf/pga/scoreboard` before any code was written.

### The mechanic (confirmed with the user directly, not inferred)

- A member picks a set number of golfers (`league.golf_pick_count`, 1–10, default 3) **before the tournament starts**.
- If **any** of those golfers is inside the top N (`league.golf_top_n`, 1–50, default 10), that's a **win** — one win/loss for the whole tournament, not per golfer.
- Two members in the same league **may** pick the same golfer. There is no draft/exclusivity mechanic — no constraint enforces uniqueness across members, only within one member's own selection.
- Grading is **live**: picks are re-graded on every leaderboard poll while the tournament is under way, so a member's outcome can flip from loss to win (or back) as the leaderboard moves, right up until the tournament goes final.

### How that differs structurally from every other sport

| Concern | Team sports / tennis / MMA | Golf |
|---|---|---|
| Tables | `game`, `pick`, `result` | `tournament`, `tournament_entry`, `golf_pick`, `golf_pick_selection` |
| Adapter | `lib/sports-provider.ts` | `lib/golf-provider.ts` |
| Jobs | `schedule-ingest` + `score-poll` (split writers) | `golf-ingest` (one job) |
| Grading | Grade-once (`outcome is null` guard, `lib/grading.ts`) | Unconditional re-grade every poll (`lib/golf-grading.ts`) |
| Pick lock | Per game, at that game's `starts_at` | Per tournament, at `tournament.starts_at` |
| Pick horizon | `league.pick_horizon_days` applies | No horizon concept — pickable as soon as ingested |
| Audit trail | `pick_audit_log` | **None** (deliberately out of scope this pass) |

**Why one job, not two.** ESPN's golf scoreboard response returns the tournament *and* its full leaderboard in a single call, so there is no separate "fetch the schedule" request to make. Splitting discovery from polling would mean two cron jobs issuing the identical HTTP request. The single-writer boundary that motivated the `schedule-ingest`/`score-poll` split for team sports doesn't apply here because there is only one writer.

**Why grading re-runs.** `gradeGolfPicks()` deliberately has no `outcome is null` guard — it behaves like `regradeGame()` (always overwrite), not `gradeFinalGame()` (grade once). This is what makes live grading work. It never touches a `'void'` pick, which stays terminal.

### Edge cases

- **Tournament postponed/cancelled** — every non-void `golf_pick` is voided (`voidTournamentPicks`), same "never a loss" rule as a cancelled game. Terminal.
- **A golfer with no leaderboard position** (`position is null` — pre-tournament, or hasn't teed off) never counts as a top-N finish. Null is not treated as "missed the cut," just as "not yet posted."
- **Cut / withdrawn golfers** — **known gap.** ESPN's golf scoreboard exposes no explicit CUT or WD marker anywhere in the response (confirmed empirically against a live, mid-Round-2 tournament — searching the entire payload for "cut" returns nothing). `order` is the only position signal available. A withdrawn golfer's behavior — whether ESPN drops them, freezes their last `order`, or reorders around them — has not been observed live and is not special-cased. Since a cut golfer will not be inside the top N in any realistic case, the practical impact on grading is nil; this is documented so it isn't mistaken for an oversight.
- **Standings credit posts on the day the tournament ENDS**, not the day it starts and not spread across its span — matching how a game's result posts on the game's own day. `lib/standings.ts` joins `tournament.ends_at`, not `starts_at`. A four-day tournament finishing Sunday counts entirely toward Sunday.
- **Zero tournaments in the window is NOT alerted**, unlike `schedule-ingest`'s all-sports-zero `captureMessage`. Golf has frequent legitimate off-weeks, so an empty run is expected rather than anomalous.

### Client

Golf gets its own screen (`/leagues/:leagueId/golf`, `apps/client/src/screens/GolfScreen.tsx`) rather than appearing on the slate — a tournament has no per-day rows to render there. The screen is a golfer multi-select before the tournament locks and a read-only leaderboard (with a top-N marker) after. It's reached via a link on the slate screen, shown only for leagues that actually cover golf, rather than a fifth bottom-nav item that would be dead for every other league.

Privacy matches the slate exactly: other members' `hasPicked` is always visible, but their actual golfer selections are withheld by the SQL itself until the tournament locks.

## Data freshness / failure visibility

See [`docs/observability.md`](observability.md) for the full alerting story (heartbeats, error tracking, `captureMessage`). Two ops-facing surfaces specific to this pipeline:

- `GET /health/data-freshness` — public, unauthenticated endpoint reporting each job's last-run/last-success status and the count of games past their sport's expected duration without a final result. Documented but not yet consumed by any frontend (none exists in this repo yet) — it's the hook a future stale-data banner would poll, and is independently useful for manually checking pipeline health.
- `apps/api/src/lib/game-staleness.ts`'s `MAX_GAME_DURATION_HOURS` — a per-sport expected-maximum-duration table (e.g. NFL 4.5h, soccer 2.5h) used both by `score-poll`'s own `captureMessage` alert and by the health endpoint, so both surfaces share one definition of "stale" rather than two that could drift apart.
