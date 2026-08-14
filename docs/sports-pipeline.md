# Sports data pipeline (JAC-19–24)

This is the authoritative spec for how games move through the pipeline and what happens in every edge case. See [`docs/adr/0003-sports-data-pipeline.md`](adr/0003-sports-data-pipeline.md) for why the design looks like this; this document is the behavior reference — what actually happens for a given real-world situation, and (where relevant) suggested user-facing copy.

## The two jobs

| Job | Schedule | Purpose | Heartbeat env var |
|---|---|---|---|
| `schedule-ingest` (`apps/api/src/jobs/schedule-ingest.ts`) | Every 4 hours (`0 */4 * * *`) | Upserts the schedule (teams, start times, non-final status) for a rolling window, plus a targeted re-fetch of postponed games | `SCHEDULE_INGEST_HEARTBEAT_URL` |
| `score-poll` (`apps/api/src/jobs/score-poll.ts`) | Every 5 minutes (`*/5 * * * *`) | Polls only games whose start has passed and aren't final yet; writes the `result` row on the transition to final | `HEARTBEAT_URL` |

`schedule-ingest` can update a game's non-final status, start time, and team names; only `score-poll` can ever set `status = 'final'` or write a `result` row. See ADR 0003's "single-writer boundary" section for why that split is enforced at the database level, not just by convention.

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

## Data freshness / failure visibility

See [`docs/observability.md`](observability.md) for the full alerting story (heartbeats, error tracking, `captureMessage`). Two ops-facing surfaces specific to this pipeline:

- `GET /health/data-freshness` — public, unauthenticated endpoint reporting each job's last-run/last-success status and the count of games past their sport's expected duration without a final result. Documented but not yet consumed by any frontend (none exists in this repo yet) — it's the hook a future stale-data banner would poll, and is independently useful for manually checking pipeline health.
- `apps/api/src/lib/game-staleness.ts`'s `MAX_GAME_DURATION_HOURS` — a per-sport expected-maximum-duration table (e.g. NFL 4.5h, soccer 2.5h) used both by `score-poll`'s own `captureMessage` alert and by the health endpoint, so both surfaces share one definition of "stale" rather than two that could drift apart.
