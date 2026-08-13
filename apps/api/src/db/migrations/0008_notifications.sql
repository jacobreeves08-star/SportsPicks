-- 0008_notifications.sql
-- Notifications (JAC-43): pick reminders and results summaries, sent by
-- email (no native client exists in this repo — see
-- docs/notifications.md for the documented push-token contract). See
-- that doc for the full design rationale.

-- Global off switch, checked first — short-circuits regardless of any
-- per-league preference below.
alter table "user"
  add column notifications_enabled boolean not null default true;

-- Per-league preference.
alter table league_member
  add column notifications_enabled boolean not null default true;

-- Push-token registration contract, documented but not wired to a live
-- route this epic (no native client exists to register one) — see
-- docs/notifications.md. Deleted outright (not anonymized) by
-- anonymize-accounts.ts, same category as session/verification_token.
create table push_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_token_user_id_idx on push_token(user_id);

-- Idempotency guard for both the pick-reminder and results-summary jobs
-- — deliberately its own table, not reused from any other log (e.g. a
-- future analytics_event table), so this table's schema isn't
-- constrained by an unrelated concern. The unique index is what makes
-- "reserve, then send only if the insert actually returned a row" work
-- as a single atomic statement, the same idiom score-poll.ts already
-- uses for exactly-once finalization.
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

create index notification_log_league_id_idx on notification_log(league_id);
