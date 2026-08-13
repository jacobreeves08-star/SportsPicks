# Analytics (JAC-44)

Self-built, server-side event log — confirmed with the user as a plain Postgres table rather than a third-party platform, since every event this epic asked for is already server-observable. No client SDK anywhere (there's no frontend in this repo to embed one in). Implementation: `apps/api/src/lib/analytics.ts`, `analytics_event` (migration `0009_analytics.sql`).

## Events logged

| Event | `event_type` | Fired from |
|---|---|---|
| Signup | `user_signed_up` | `auth.routes.ts` `/signup`, real-account-created branch only — never the duplicate-email notice branch, since that isn't a new user |
| League created | `league_created` | `leagues.routes.ts` `POST /` |
| League joined | `league_joined` | `league-invites.routes.ts` `POST /join`, success branch only |
| Pick submitted | `pick_submitted` | `lib/pick-write.ts`'s `writePick()`, on every accepted write (covers both the single-pick and batch routes for free — one call site) |
| Slate completed | `slate_completed` | Same call in `writePick()`, immediately after `pick_submitted` — fires the moment a member has zero unpicked non-postponed/cancelled games left in that day's slate (the league's timezone, matching every other "what day is it" computation in this app) |

`slate_viewed`/`reminder_opened`/`picks_after_reminder`/`next_day_return` from the original ask are **not** implemented as their own discrete `logEvent` calls this epic — see "What's not built" below.

## `logEvent` — best-effort, never blocks a real action

```ts
logEvent(eventType: string, params?: { userId?, leagueId?, leagueMemberId?, metadata? }): Promise<void>
```

Wrapped in try/catch, reports to error tracking on failure, and always resolves — analytics failing must never break the user action it's attached to. `metadata` must never carry PII, the same discipline `pick_audit_log`/`result_correction` already follow (only IDs and non-identifying context, e.g. `{ gameId }`, `{ date }`).

`userId`/`leagueId`/`leagueMemberId` are all nullable and never cascade-deleted (see `docs/account-anonymization.md`) — a signup event has no league yet, and historical analytics rows outlive an account being anonymized or (hypothetically) a league going away.

## The metric that matters: slate completion rate — computed from ground truth, not the event log

The user's own framing: **% of members completing their slate before first lock, by league.** `computeSlateCompletionRate(leagueId, date)` answers this directly from `pick_audit_log`/`game`/`league_member` — **never** from `analytics_event`. The event log is best-effort and can miss events; it was never meant to be an authoritative source, so a metric this central can't be built on top of it.

For a given league and day:
1. Find today's games (league timezone, excluding `postponed`/`canceled` — nothing actionable about them, same exclusion `pick-reminder.ts` and `results-summary.ts` already apply). No games today → `rate: null` (nothing to measure).
2. The **first lock** is the earliest `starts_at` among those games.
3. For every active member (`left_at is null`), check whether they have a `pick_audit_log` entry for **every** game in the slate, where each entry's timestamp is **at or before** the first lock.
4. `rate = completedCount / totalMembers`. No active members → `rate: null`.

### The finalization signal: `pick_audit_log`'s `MAX(created_at)`, not `pick.created_at`

This is the one finding worth calling out explicitly, same weight as the `result.created_at` vs `game.updated_at` finding in `docs/scoring-and-standings.md`. `pick.created_at` is set once, at insert, and is **never touched** by `writePick`'s `ON CONFLICT DO UPDATE` — an early pick made well before the first lock, then edited afterward, would still show its original (early) `created_at` if read from `pick` directly. That would wrongly count the member as on-time when their actual, settled answer only became final after the lock.

`computeSlateCompletionRate` instead reads the **latest** `pick_audit_log` row per `(league_member_id, game_id)` — the true "when did this member's answer for this game become final" signal — and requires that latest timestamp to be at or before the first lock for every game in the slate. `apps/api/src/lib/analytics.test.ts` has a dedicated regression test for exactly this: an early `create` audit row before the first lock, followed by a `change` row after it, must count as **late**, not on-time.

## What's not built this epic

- **`slate_viewed`** — would reuse `logEvent` from the slate route (`GET /:leagueId/slate`), but isn't wired up yet: the slate route is cached (`docs/rate-limiting-and-caching.md`) and heavily polled by design, so logging every read would flood `analytics_event` with near-duplicate rows for the same viewer within one `SLATE_CACHE_TTL_SECONDS` window. Needs a dedup strategy (e.g. only log on a cache miss) before it's worth turning on — flagged, not solved here.
- **`reminder_opened`** — would need a tracking pixel or link-click endpoint in the reminder email itself; no such endpoint exists yet.
- **`picks_after_reminder`** / **`next_day_return`** — these are computed metrics (joining `analytics_event`'s `pick_reminder`-adjacent timestamps — once `reminder_opened` exists — against `pick_audit_log`, or joining two days of login/session activity), not discrete event types. Nothing computes them yet; `computeSlateCompletionRate` was the one metric the user called out as mattering most, and got the full ground-truth treatment above. The others are straightforward queries to add once there's a reason to read them (e.g. the closed-beta operator digest, JAC-48).

## `analytics_event` retention

Never scrubbed or deleted by `anonymize-accounts.ts` — see `docs/account-anonymization.md`. Rows carry no PII by construction (`metadata` is populated only with IDs/non-identifying context), and `user_id`/`league_id`/`league_member_id` referencing an anonymized account or a departed member is expected, not a bug: the event still happened and is useful in aggregate even once the actor's identity is gone.
