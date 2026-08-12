-- 0004_leagues_membership.sql
-- Leagues and membership (JAC-25 through JAC-30): soft leave/remove,
-- commissioner-invariant enforcement, invite codes, member reports.
-- See docs/leagues-and-membership.md for the full design rationale.

-- Soft leave/remove: never a DELETE, so a departed member's picks stay
-- attached to their (now-inactive) league_member row for standings
-- integrity, and the existing unique(user_id, league_id) constraint
-- forces a rejoin to reactivate this SAME row (see the join CTE in
-- league-invites.routes.ts) rather than insert a new one — which is
-- exactly what makes "rejoining restores prior picks" true for free.
-- "Active member" = left_at is null, everywhere.
alter table league_member add column left_at timestamptz;

-- Commissioner invariant, part 1: league.commissioner_id (already NOT
-- NULL) stays the single source of truth — a single-valued column
-- trivially guarantees "exactly one commissioner" by construction.
-- league_member.role stays a stored, denormalized column (unchanged),
-- kept in sync by this trigger whenever commissioner_id changes (i.e.
-- on a transfer). GET DIAGNOSTICS / row_count guards against a buggy
-- transfer target that isn't actually an active member of this league
-- — without it, commissioner_id would silently point at someone with
-- no corresponding 'commissioner' row, leaving the league with zero.
create or replace function sync_commissioner_role()
returns trigger as $$
declare
  promoted integer;
begin
  update league_member
    set role = 'member'
    where league_id = new.id and role = 'commissioner' and user_id != new.commissioner_id;

  update league_member
    set role = 'commissioner'
    where league_id = new.id and user_id = new.commissioner_id and left_at is null;
  get diagnostics promoted = row_count;

  if promoted <> 1 then
    raise exception 'commissioner_id % for league % does not match exactly one active member', new.commissioner_id, new.id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger league_sync_commissioner_role
  after update of commissioner_id on league
  for each row execute function sync_commissioner_role();

-- Commissioner invariant, part 2: a backstop for what the trigger above
-- does NOT cover — league creation (where the app must insert the first
-- league_member row itself, in the same transaction as the league row,
-- with nothing tying the two together automatically) and any future
-- code that writes league_member.role directly. A partial unique INDEX
-- can't be deferrable, and a deferrable CONSTRAINT can't have a WHERE
-- clause — a deferrable partial EXCLUDE constraint is the one construct
-- that is both, which is why this needs btree_gist (EXCLUDE requires a
-- GiST-compatible operator class, which plain equality on uuid doesn't
-- have without it). DEFERRABLE INITIALLY DEFERRED means this is only
-- checked at COMMIT — safe alongside the trigger's own transient
-- two-statement intermediate state (old commissioner cleared, then the
-- new one set) within one transaction.
create extension if not exists btree_gist;

alter table league_member
  add constraint league_member_one_commissioner_per_league
  exclude using gist (league_id with =) where (role = 'commissioner' and left_at is null)
  deferrable initially deferred;

-- One invite code per league (one-to-one via the unique on league_id).
-- Rotation overwrites `code` and resets `uses_count` on this same row —
-- no history table, matching "rotatable" literally without over-building.
create table league_invite_code (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references league(id),
  code text not null unique,
  max_uses integer,
  uses_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger league_invite_code_set_updated_at
  before update on league_invite_code
  for each row execute function set_updated_at();

-- Member reporting to the commissioner (JAC-30) — a visible list, not a
-- moderation platform: no status/review workflow, no notification
-- (Epic 7 doesn't exist yet).
create table league_member_report (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id),
  reporter_league_member_id uuid not null references league_member(id),
  reported_league_member_id uuid not null references league_member(id),
  reason text not null,
  created_at timestamptz not null default now()
);

create index league_member_report_league_id_idx on league_member_report(league_id);
