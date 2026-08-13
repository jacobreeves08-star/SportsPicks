# Notifications (JAC-43–48)

Two dedicated cron jobs, each mirroring `score-poll.ts`'s shape (own heartbeat, `recordJobRun`, `*/10 * * * *`): `apps/api/src/jobs/pick-reminder.ts` and `apps/api/src/jobs/results-summary.ts`. Delivery is email-only this epic — see "Push notifications" below for why, and the documented contract for adding it later. Both jobs share one idempotency mechanism (`notification_log`) and two preference switches (`user.notifications_enabled`, `league_member.notifications_enabled` — global always checked first, short-circuits regardless of the per-league setting).

## Why two separate jobs, not one

`pick-reminder` and `results-summary` have genuinely different correctness dependencies: the reminder only needs to know when a lock is coming, the summary depends on grading having already happened and on the standings engine. Bolting them together (or onto `score-poll.ts`) would couple two unrelated failure modes onto one heartbeat, making "did notifications run on time" ambiguous — the same reasoning that already keeps `schedule-ingest`/`score-poll`/`anonymize-accounts` on separate schedules and separate monitors.

## `notification_log` — the idempotency guard for both jobs

```sql
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('pick_reminder', 'results_summary')),
  league_id uuid not null references league(id),
  league_member_id uuid not null references league_member(id),
  notification_date date not null,
  created_at timestamptz not null default now()
);
create unique index notification_log_dedupe_idx
  on notification_log(notification_type, league_member_id, notification_date);
```

Both jobs use the same **reserve-then-send** pattern score-poll already uses for exactly-once finalization, applied here via `ON CONFLICT DO NOTHING RETURNING id` instead of a conditional `UPDATE`: an email only goes out if the insert actually returned a row. A second run in the same window (a retry, an overlapping schedule, a crash-and-restart) is a pure no-op for anyone already reserved — never a double-send.

Kept as its own table rather than folded into `analytics_event` — this codebase has already made the equivalent call twice before for exactly this shape of question (`pick_audit_log` kept separate from `pick`; `result_correction` kept separate from `revision_count`), specifically so one table's schema isn't constrained by a second, unrelated concern.

## `pick-reminder.ts`

Runs every 10 minutes. For each league, computes "today" and today's day-bounds using the **league's** timezone via the already-tested `dayBoundsUtc` (Luxon) helper — the same convention the slate endpoint and standings already use for "what day is it for this league." This is deliberately **not** the raw-SQL `AT TIME ZONE` idiom `isSportsSelectionFrozen` uses elsewhere: that idiom hasn't been verified against a real DST transition, and `dayBoundsUtc` already has been (see `apps/api/src/jobs/pick-reminder.test.ts`'s dedicated DST-boundary test, below).

If today's first lock (earliest `starts_at` among today's non-`postponed`/`canceled` games) falls within `REMINDER_LEAD_TIME_MINUTES` (default 60) from now, every active member (`left_at is null`) with notifications enabled (global and per-league) and **at least one unpicked game** in today's non-postponed/cancelled slate gets exactly one email, listing every game they still need to pick. A member who has already picked everything today never receives anything — this is enforced structurally by the recipient query's `not exists (... pick ...)` clause, not by a separate check.

Postponed/cancelled games are excluded from both the first-lock computation and the "still needs to pick" set — `writePick()` already rejects picks against either status, so counting them as unpicked would nag about a game nobody can act on.

`REMINDER_LEAD_TIME_MINUTES` combined with the 10-minute cadence bounds lead-time precision to roughly ±10 minutes — an accepted precision tradeoff, not a bug.

**Flagged, implemented literally as specified, not silently expanded**: "before the first lock of the day" means the literal first lock only. A league with an early game and a separate later slate the same day sends exactly one reminder, anchored to the early lock — a member who misses that window gets no further nudge before the later lock, even though picking is still open for it. This may be a real product gap; confirm before assuming broader coverage was wanted.

## `results-summary.ts`

Runs every 10 minutes. A league's day is a **candidate** once it has at least one game today (league timezone) and **none** of today's games remain `scheduled`/`in_progress` — `final`/`postponed`/`canceled` all count as settled, since there's nothing left to wait for on any of them.

For each settled league, `computeStandings(leagueId, 'today', today)` is reused directly from `lib/standings.ts` (Epic 6) — no separate win/loss computation. `rankChange` reuses the same prior-day diff `standings.routes.ts` already computes for the read API: `computeStandings(leagueId, 'today', yesterday)`, diffed by `leagueMemberId`. Because `computeStandings` always returns an entry for every active member (even one with zero picks, at 0–0), a "yesterday" rank is always available for an active member — `rankChange` is a plain number far more often than `null` in practice, matching the read API's existing behavior exactly rather than inventing a different convention for the email.

Each eligible recipient (active, notifications enabled globally and per-league) gets their own record for the day, current rank, and movement since yesterday.

**Reserved and sent per member, not per league** — this is what makes the job resumable after a partial failure. If it crashes after emailing 3 of 8 members, "settled" is a fact about the games, not about whether this job already ran, so the next run's candidate check still matches; the per-member `notification_log` guard means only the remaining 5 get sent, never a re-send to all 8 or a permanent skip of all 8. See `apps/api/src/jobs/results-summary.test.ts`'s dedicated partial-failure-resumability test, which pre-seeds one member's `notification_log` row and asserts only the remaining member gets emailed on that run.

**Flagged, not fixed**: score-poll's automatic revision detection re-checks final games for up to `REVISION_CHECK_WINDOW_HOURS` (default 48h) after `result.created_at` (see `docs/scoring-and-standings.md`). If a provider revision lands **after** today's digest already sent, the per-member-per-day `notification_log` guard means no second digest goes out for that day — a member's emailed standings can go stale relative to a correction they were never told about. Accepted limitation, not addressed this epic.

## Preferences

- `user.notifications_enabled` (default `true`) — the global off switch. Checked first; `false` here means neither job ever emails that user, regardless of any league's setting.
- `league_member.notifications_enabled` (default `true`) — per-league. Lets a member mute one league's notifications without going fully dark everywhere.

Neither job has a UI to flip these yet (no frontend exists) — both are plain columns, settable via a future settings endpoint or directly for now.

## Operator digest — a third job, not a member-facing one

`apps/api/src/jobs/operator-digest.ts` (daily, `0 13 * * *`, own heartbeat) is closed-beta observability (JAC-48), not a member notification: it emails `getOpsSummary()`'s output (`lib/ops-summary.ts` — job health, stale games, 24h activity counts, per-league slate completion) to a single static recipient, `env.OPERATOR_EMAIL`. Unset → no-op with a warning log, same convention as every other optional env var in this app. Idempotency is a plain `job_run` check for an already-succeeded run today — the per-member `notification_log` mechanism above exists specifically for fan-out to many recipients, which doesn't apply here. This is the tool that makes "seven consecutive days where nobody had to ask what happened" checkable without anyone remembering to curl `/health/data-freshness` themselves.

## Push notifications — schema only, no delivery this epic

Confirmed with the user: push is out of scope this epic; email covers both jobs. The schema exists so a later epic can add delivery without a migration:

```sql
create table push_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**The registration contract for a future frontend** (documented, not built): a client that acquires a platform push token (APNs/FCM/web-push) would `POST` it to a not-yet-built endpoint (e.g. `POST /users/me/push-tokens { token, platform }`), upserted on `token`'s unique constraint so a re-registration from the same device is idempotent. Sending would mean, for each job above, checking for a recipient's push tokens first and falling back to email only if none exist (or sending both, TBD by product at that point) — no job logic here anticipates that fork yet; it would be a genuinely new branch, not a drop-in replacement for `EmailProvider`.

`push_token` rows are hard-deleted (not anonymized) when an account is deleted — see `docs/account-anonymization.md` for the full retention table.
