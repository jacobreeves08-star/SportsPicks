-- 0002_auth.sql
-- Authentication & identity (JAC-13 through JAC-18): new user columns,
-- session table (opaque access/refresh tokens), verification_token table
-- (email verify / email change / password reset — single-use, expiring).
-- See docs/adr/0002-auth-session-hashing-email.md for the design rationale
-- and docs/account-anonymization.md for the deletion/anonymization spec.

alter table "user"
  add column pending_email text,
  add column email_verified_at timestamptz,
  add column avatar_url text,
  add column deletion_requested_at timestamptz,
  add column scheduled_deletion_at timestamptz,
  add column anonymized_at timestamptz;

-- Partial unique index: allows many nulls (most users have no pending
-- email change in flight) but no two users mid-change to the same address.
create unique index user_pending_email_unique_idx on "user"(pending_email)
  where pending_email is not null;

-- One row per device/session. Refresh rotates both tokens in place
-- (overwrites the hashes + extends refresh_token_expires_at) rather than
-- inserting a new row — this is not a token-history table.
create table session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index session_user_id_idx on session(user_id);

-- Single generic table for every single-use, expiring token this app
-- issues by email. Issuing a new token of a given purpose for a user
-- invalidates (deletes) that user's prior unconsumed tokens of the same
-- purpose — see lib/verification-tokens.ts — so a stale link can never
-- coexist with a fresher one.
create table verification_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  purpose text not null
    check (purpose in ('email_verify', 'email_change', 'password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index verification_token_user_purpose_idx on verification_token(user_id, purpose);
