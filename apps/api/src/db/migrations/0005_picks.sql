-- 0005_picks.sql
-- Picks and lock enforcement (JAC-31 through JAC-36): an append-only
-- audit trail of every pick write. See docs/picks-and-locking.md for
-- the full design rationale.

-- "Never mutated or deleted by application code" — backstopped at the
-- DB level, same idiom as check_pick_selected_team (0001_init.sql) and
-- the commissioner-invariant trigger (0004_leagues_membership.sql).
-- REVOKE was considered and rejected: this app connects as a single
-- table-owning role, and a table's owner bypasses ordinary GRANT/REVOKE
-- privilege checks, so REVOKE would need a second, non-owner DB role to
-- actually bite — real new infrastructure, not a migration-only change.
create table pick_audit_log (
  id uuid primary key default gen_random_uuid(),
  league_member_id uuid not null references league_member(id),
  game_id uuid not null references game(id),
  selected_team text not null,
  action text not null check (action in ('create', 'change')),
  created_at timestamptz not null default now()
);

create index pick_audit_log_league_member_id_idx on pick_audit_log(league_member_id);
create index pick_audit_log_game_id_idx on pick_audit_log(game_id);

create or replace function reject_pick_audit_log_mutation()
returns trigger as $$
begin
  raise exception 'pick_audit_log is append-only; % is not allowed', TG_OP;
end;
$$ language plpgsql;

create trigger pick_audit_log_no_update
  before update on pick_audit_log
  for each row execute function reject_pick_audit_log_mutation();

create trigger pick_audit_log_no_delete
  before delete on pick_audit_log
  for each row execute function reject_pick_audit_log_mutation();
