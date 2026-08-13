-- 0009_analytics.sql
-- Analytics (JAC-44): self-built, server-side event log — no
-- third-party platform, no client SDK, since every listed event is
-- already server-observable. See docs/analytics.md.

-- user_id/league_id/league_member_id are all nullable: a signup event
-- has no league yet. No FK ever needs an ON DELETE clause anywhere in
-- this schema (matching every other table here) because rows are
-- anonymized, never hard-deleted — see docs/account-anonymization.md.
create table analytics_event (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references "user"(id),
  league_id uuid references league(id),
  league_member_id uuid references league_member(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index analytics_event_type_created_at_idx on analytics_event(event_type, created_at);
