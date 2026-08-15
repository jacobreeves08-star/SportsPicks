# Daily college trivia

"Which college did this player attend?" — five NFL players a day, five colleges each, one guess apiece. Playable with no account from the home page, or from a button on the leagues home after logging in. A logged-in player's results are tracked against their profile; either way the result can be shared.

This is the first feature in the app that is **not scoped to a league**. It has no commissioner, no membership, no lock time, and no standings credit, and it is graded instantly against a fact rather than against a future result. That's why it gets its own tables rather than reusing `game`/`pick` or `tournament`/`golf_pick` — see [`0015_college_trivia.sql`](../apps/api/src/db/migrations/0015_college_trivia.sql).

## The daily puzzle

**Everyone in the world gets the same five players on the same day.** That single property drives most of the design: a shared score ("4/5") is only meaningful against an identical board, and sharing is half of what this feature is for.

Concretely:

- A puzzle is **built once and frozen** — five `trivia_question` rows, each with its five options already shuffled into a fixed display order. It is never regenerated per request and never varies per viewer.
- Building is **lazy**, on the first request of the day, not cron-driven. A puzzle that only exists once a nightly job has run is a puzzle that's missing entirely if that job failed, and this feature has no upstream deadline to respect (unlike score polling). Concurrency is settled by `trivia_puzzle.puzzle_date`'s unique constraint: two simultaneous first-requests both attempt the insert, the loser re-reads the winner's rows.
- The day boundary is a **single fixed anchor timezone**, `America/New_York` — deliberately *not* the caller's `user.timezone` and *not* a league's. This departs from how the rest of the app decides what day it is (a slate's boundary is the league's timezone, see [`picks-and-locking.md`](./picks-and-locking.md)), and it has to: a per-viewer rollover would hand two friends different players at the same instant, and the comparison the sharing feature exists for would be comparing nothing.
- `puzzle_number` (the "#14" a shared result is labelled with) is **stored, not derived** at read time, so moving the epoch constant later can never renumber a puzzle somebody already shared.

### Question selection

Candidates are drawn best-first from four tiers, each consulted only if the ones above came up short:

1. Active roster, **depth-chart starter**, and a recognizable position (`QB`/`RB`/`WR`/`TE`)
2. Active roster and a recognizable position
3. Active roster, any position
4. Anyone in the pool

The starter tier is the one that answers "have people actually *heard of* this player?". Active-plus-skill-position alone kept surfacing third-stringers — a WR6 matches that filter exactly as well as a franchise quarterback — so the ingest also pulls each team's ESPN depth chart and flags every athlete listed *first* in a slot (`nfl_athlete.is_starter`, migration [`0016_athlete_starters.sql`](../apps/api/src/db/migrations/0016_athlete_starters.sql)). If a team's depth chart can't be fetched on a given run, the flag is left as it was rather than demoting the whole team; the roster fetch alone never clears it.

Kickers were dropped from the recognizable positions entirely: outside a couple of names, even a starting kicker is obscure. They remain reachable through the any-active tier.

A quiz made of practice-squad long snappers is technically valid and completely unplayable, hence the preference — but a thin pool degrades to a *harder* quiz rather than to no quiz. Players used in the last 30 days are avoided, and that avoidance is never allowed to be the reason a puzzle comes up short.

The four wrong colleges come from colleges other real NFL players attended, so every option is a plausible football school. They're excluded **by college name, not by athlete** — two teammates from the same school would otherwise let the right answer appear twice, making the question unanswerable.

### The correct answer never ships with the question

`trivia_question.answer_index` is absent from every read path. `GET /trivia/daily` returns the five options and nothing about which is right; `POST /trivia/daily/answers` is the only way to learn it, one question at a time, after committing to a choice. Without this the whole feature is defeated by opening devtools, so it's asserted directly in both [`trivia-puzzle.test.ts`](../apps/api/src/lib/trivia-puzzle.test.ts) and [`trivia.routes.test.ts`](../apps/api/src/routes/trivia.routes.test.ts).

## Playing logged in vs. logged out

Both audiences hit the **same endpoints and the same screen**. The endpoints are optionally-authenticated (`optionalAuthenticate`, the same preHandler the invite-preview route uses), and grading runs through identical code either way. The only difference is where the answered round is stored.

| | Logged in | Logged out |
|---|---|---|
| Round stored in | `trivia_attempt` / `trivia_answer` | `localStorage` ([`guest-attempt-store.ts`](../apps/client/src/trivia/guest-attempt-store.ts)) |
| Survives refresh | Yes | Yes |
| Survives new device / cleared cache | Yes | No |
| One-round-per-day enforced | **Yes, server-side** | No — see below |
| Feeds profile metrics | Yes | No |

**The guest gate is not enforcement, and the code doesn't pretend it is.** Clearing site data or opening a private window resets it, and there is no way around that for someone with no account: the server has nothing to key an attempt to. What it buys is the honest common case — a guest who finishes and refreshes sees their result again rather than an invitation to farm a better score. The screen says "Playing as a guest — log in to track your streak" **before** the round, not after, so nobody builds a streak that was never being kept.

For a logged-in player, "one activation per day" is real:

- `trivia_attempt` is unique on `(user_id, puzzle_id)`.
- `trivia_answer` is unique on `(attempt_id, question_id)`, and the route **refuses to overwrite** — a second POST for an already-answered question returns the *stored* answer unchanged rather than re-grading. So replaying a round after the first response revealed the right answer cannot improve a score.
- Questions from a previous day are rejected (`questionBelongsToPuzzle`), so a stored question id can't be graded into today's attempt forever.

## Profile metrics

`GET /trivia/me/stats` (authenticated — there is no anonymous history) returns days played, current and best streak, total correct/answered, accuracy, perfect days, and a strip of recent rounds. Everything is **derived on read** from `trivia_attempt`; no denormalized streak counter lives on the user row, since a streak is a function of *which days have an attempt* and a stored counter would need repairing after any change of definition or backfill. A user has at most one row per day, so this stays a tiny scan.

Two deliberate choices in [`trivia-stats.ts`](../apps/api/src/lib/trivia-stats.ts):

- **A day counts as played if at least one answer landed**, not only a completed five. Someone whose browser died on question four showed up; resetting a 40-day streak for that is how people stop playing. Accuracy already measures how they did — the streak measures that they turned up.
- **The current streak tolerates today being unplayed.** Until the day is over, a streak that ran through yesterday is still alive; showing it as 0 all morning would be wrong.

`accuracyPct` is `null` (not `0`) when nothing has been answered — "no data" and "0% accuracy" are different things, and the profile renders them differently.

## The result screen's voice

The card gets less polite as the score drops — a perfect round is congratulated, a shutout is heckled — via `scoreVerdict()` in [`CollegeQuizScreen.tsx`](../apps/client/src/screens/trivia/CollegeQuizScreen.tsx). Six tiers, each a headline plus a one-line jab, and the score itself turns red below 60%. This is a trash-talk pick'em app whose whole sharing loop is comparing scores with friends; "Nice work" under a 1/5 is a lie, and a screen that praises every outcome identically says nothing about any of them.

Two properties the copy has to keep:

- **Deterministic.** The same round says the same thing on every render and after a refresh. Rotating through random taunts would mean the card someone screenshots isn't the card they get back — and would make the tiers untestable for no gain.
- **Scored on the ratio, not the raw count**, so the tiers still land if `questionCount` (server-driven) is ever something other than five. The two tiers that name a number — "one away" and the blind-guessing jabs — are the exceptions, and they're gated on a count or hold at any count: with five options per question, guessing blind averages exactly one right, so 1/5 genuinely is par for someone who knows nothing and 0/5 genuinely is below it.

## Sharing

One button, using the Web Share API when the browser has it (on a phone that one tap covers text message, every social app, and email at once), falling back to copy-to-clipboard on desktop. Same two-path structure as the existing [`ShareResultsButton`](../apps/client/src/app-shell/ShareResultsButton.tsx), and which UI renders is decided from `navigator.share`'s presence at render time rather than inside the click handler, so a test can mock the global to exercise either path.

The share text is **spoiler-safe by construction** — day number, score, and a row of squares, with no player names and no colleges:

```
Pick'em College Quiz #14 — 4/5
🟩🟩🟥🟩🟩

Five NFL players, five colleges each — think you can beat 4/5? 🏈
```

The whole point of everyone getting the same five players is that a friend can play the *same* quiz; a share naming the players would ruin the thing it's advertising. The squares are built from a boolean per question, so there is no path by which a name could reach the text.

**Misses are red**, matching the miss color the result screen itself uses. Red/green is the one pairing red-green color blindness can't separate, so the row is never the only statement of the result — the score is spelled out in numbers on the line above, and that line is what the text leads with. (This replaced an earlier white square, chosen on the theory that a wall of red reads as failure. It does; that's the point.)

The shared link points at `/college-quiz`, the **public** route, since the recipient may well have no account.

### How the link is presented

A raw address is the least persuasive thing that link could be, but **a text message is plain text** — there is no anchor text to be had there, and no amount of formatting changes that. So the link gets dressed up in the two places where it can be:

- **The preview card.** `navigator.share` is given the URL as its own `url` field rather than pasted onto the end of the text, which is what lets Messages/WhatsApp/Slack recognize it as a link to unfurl. The card's copy comes from the Open Graph tags in [`index.html`](../apps/client/index.html) — deliberately in the static HTML, since the crawlers that build those cards don't execute JavaScript, and deliberately describing the quiz, since every other route in this app is behind a login. There is deliberately no `og:image`, and `twitter:card` is `summary` rather than `summary_large_image` for the same reason: the card is meant to be a link carrying a line of copy, not a picture taking over someone's thread.
- **The rich-text flavor.** The copy button writes *two* clipboard flavors in one `ClipboardItem` — `text/html` with a real `<a>` reading "Play today's quiz →" and no visible address, plus `text/plain` where the URL is spelled out. Paste into Slack, Gmail, or Notes and you get the clickable label; paste into a text message and you get the plain version, which is all a text message can hold anyway. Where `ClipboardItem` doesn't exist (older Safari/Firefox, jsdom) it falls back to `writeText` with the plain flavor.

The URL is escaped on its way into the HTML flavor. It's app-composed from `window.location.origin`, but the output lands on a system clipboard and is pasted into other people's applications, which is not the place to be relying on that.

## Player data

Ingested from ESPN's per-team NFL roster endpoint by [`nfl-athlete-ingest`](../apps/api/src/jobs/nfl-athlete-ingest.ts) — `/teams` for the 32 ids, then `/teams/{id}/roster` and `/teams/{id}/depthcharts` for each (the latter solely for the starter flag). Confirmed live: the roster response embeds the full athlete object including `college`, so ~65 requests get the whole league. The obvious-looking alternative (`sports.core.api.espn.com/.../athletes`) returns a page of `$ref` URLs whose college has to be dereferenced one athlete at a time — thousands of requests for the same data. Same reasoning as [`adr/0003-sports-data-pipeline.md`](./adr/0003-sports-data-pipeline.md).

A real run yields ~2,970 athletes across ~260 distinct colleges.

Behavior worth knowing:

- **Athletes with no college are dropped**, not stored with a null. A handful of International Player Pathway players carry no `college` object at all (confirmed live), and "which college did he attend?" has no answer for them — that isn't incomplete data, it's an unanswerable question.
- **The job is purely additive.** A player who retires stops being returned by ESPN and their row simply stays; deleting them would break `trivia_question.athlete_id` for every past puzzle they appeared in, rewriting history for anyone who shared a result. They fall out of new puzzles naturally as their `roster_status` stops being refreshed.
- **One unreachable team costs 1/32nd of a run, not the run.** The pool is upserted, so the previous ingest's rows for that team survive untouched.
- **Zero athletes is anomalous** and logged at error level (unlike golf-ingest, which has legitimate off-weeks) — the 32 rosters are populated year-round. The run is still recorded as succeeded, because nothing threw and the existing pool is untouched and still perfectly playable.

It runs **weekly**, not every few minutes: a player's college never changes at all, and the only volatility is roster churn, which resolves weekly at best. The quiz is fully playable from a week-stale pool.

```bash
npm run nfl-athlete-ingest --workspace apps/api
```

With `SPORTS_API_PROVIDER=mock` (the local default) the provider returns nothing, so a fresh dev database has an empty pool and the quiz correctly reports `TRIVIA_UNAVAILABLE` until a live ingest is run.

## Routing: `/` became public

Before this feature, `/` was auth-guarded and its only behavior for a stranger was to redirect to `/login` — this app's front door was a password field. The quiz has to be playable with no account, and a shared result link has to land somewhere that isn't a login form, so `/` moved off `authenticatedLayoutRoute` to the root and now decides *what to render* from auth state instead of refusing to render at all:

- **Logged out** → [`PublicHomeScreen`](../apps/client/src/screens/PublicHomeScreen.tsx) — the marketing hero (mirroring the login screen's, so the two read as one product) with the quiz as its primary action.
- **Logged in** → the existing leagues `HomeScreen`, inside the full app shell.

`/college-quiz` is public for the same reason. Both use [`MaybeShell`](../apps/client/src/app-shell/MaybeShell.tsx), which supplies the nav chrome when there's a session and a bare `<main>` landmark when there isn't — one URL, one screen, and the difference confined to the chrome around it. Duplicating each screen under both a public and a protected route would mean two routes to keep in step for one screen.

**Every other protected route is unchanged** and still guarded by `authenticatedLayoutRoute` exactly as before.

## API

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /trivia/daily` | Optional | Today's five questions. Never includes the answers. `tracked` says whether this run is being saved; `attempt` carries server-side progress for a logged-in caller, `null` otherwise. |
| `POST /trivia/daily/answers` | Optional | `{ questionId, selectedIndex }`. Grades and reveals the right answer. Idempotent for a logged-in caller — a repeat returns the stored answer, never a re-grade. |
| `GET /trivia/me/stats` | Required | The caller's own metrics. |

`TRIVIA_UNAVAILABLE` (503) means the player pool hasn't been ingested yet. It's a 503 with its own code rather than a 500 because nothing is broken — the data just isn't there — and the client shows "check back soon" instead of an error state with a Retry button that couldn't work.
