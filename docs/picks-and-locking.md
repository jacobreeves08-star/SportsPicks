# Picks and lock enforcement (JAC-31–36)

Scoring is straight-up: one point per correct winner, no spreads. This is the authoritative spec for how picks get written, how locking actually works, who can see what, and the API contract a future client needs. See [`docs/data-model.md`](data-model.md) for the schema and [`docs/api-conventions.md`](api-conventions.md) for the error codes. Routes live in `apps/api/src/routes/leagues.routes.ts` (single-pick write, batch write, slate, audit log); the shared write logic is `apps/api/src/lib/pick-write.ts`.

## Lock enforcement — the one thing this document exists to get right

"Reject any pick written at or after its game's scheduled start" is enforced in exactly one place: `writePick()`'s atomic SQL statement, never anywhere else, and never by trusting anything the client sends. The client's clock is never consulted — a manipulated device clock, a page left open since morning, and a hand-crafted `curl` request are all rejected identically, because none of them can influence what the statement itself reads for `starts_at`.

`writePick()` is two-phase, deliberately:

- **Phase 1** pre-validates everything *except* the lock, in application code, against one already-fetched `game` row: the sport is part of the league, the game isn't `canceled` or `postponed` (a postponed game's `starts_at` doesn't reliably mean anything until schedule-ingest finds a real new time — locking it out entirely, not just leaving it to the time check, avoids accepting a pick against a stale value), and `selectedTeam` is one of the two actual teams (or `'DRAW'` when the game allows it). This phase's own `now() >= startsAt` check is a fast-path courtesy only — it saves a round trip for an obviously-locked game, but it is **not** the enforcement, and a game that locks in the tiny window after this check still gets caught by phase 2.
- **Phase 2** is the one real enforcement point: a single atomic statement that re-reads `starts_at` fresh as part of the very same statement — never from phase 1's read, never from an earlier request — so a game whose start time changes between requests locks at the *new* time by construction, not because anything remembered to re-check:

```sql
with upserted as (
  insert into pick (league_member_id, game_id, selected_team)
  select $1, $2, $3
  where exists (
    select 1 from game
    where id = $2 and starts_at > now() and status not in ('canceled', 'postponed')
  )
  on conflict (league_member_id, game_id) do update set selected_team = excluded.selected_team
  returning id, league_member_id, game_id, selected_team, created_at, (xmax = 0) as was_insert
),
logged as (
  insert into pick_audit_log (league_member_id, game_id, selected_team, action)
  select league_member_id, game_id, selected_team, case when was_insert then 'create' else 'change' end
  from upserted
  returning id
)
select u.* from upserted u, logged l
```

If zero rows come back, the only remaining explanation — everything else was pre-validated in phase 1 — is that the game locked in the narrow window between the fast-path check and this statement. That's a real race, resolved correctly by construction: this statement is the one that actually decided it, at the moment it ran.

### Why this needed to be verified against real Postgres before shipping, not just reasoned about

Three raw-SQL assumptions in this design were empirically checked against a real database before being trusted in route code — this codebase's standing practice after three prior epics where a plausible-sounding assumption turned out wrong once actually tested:

1. **A data-modifying CTE chained after another executes as a required side effect even when the final `SELECT` never references it by name.** `logged` is never read by the outer `select`, but it still runs — confirmed, and this is documented Postgres behavior (distinct from the PG12+ read-only-CTE-inlining optimization, which explicitly doesn't apply to data-modifying statements). Written as `select u.* from upserted u, logged l` rather than a bare `select * from upserted` anyway — not because the unreferenced form is wrong, but so a future refactor that "simplifies" the query can't silently drop a CTE nobody visibly depends on.
2. **`(xmax = 0)` in the `RETURNING` clause correctly distinguishes an `INSERT` from an `ON CONFLICT DO UPDATE`** within the same statement, without a separate read — confirmed, and used to pick `'create'` vs `'change'` for the audit log entry.
3. **The lock gate produces zero rows *and* zero audit-log side effects** for an already-started game — confirmed; a rejected write leaves no trace in `pick_audit_log`, only accepted writes do.

This all depends on Postgres's default READ COMMITTED isolation (never overridden anywhere in this app), so each statement in a multi-write transaction — the batch endpoint's loop, below — sees fresh data rather than a snapshot taken at the transaction's start.

## The batch endpoint's per-game independence

`POST /:leagueId/members/:memberId/picks/batch` writes a full slate at once, and requirement 3 is explicit that locking applies **per game, not to the batch as a whole** — five submitted picks with two already-started games must resolve to three accepted and two rejected, with per-game detail, not an all-or-nothing failure.

One outer `db.transaction()` wraps the whole batch so accepted writes become visible together, but each game's `writePick()` call runs inside its **own nested transaction** — a real Postgres `SAVEPOINT`, via Drizzle's nested `db.transaction()` support on the `node-postgres` driver (also verified empirically: an inner failure rolls back only the inner scope, leaving outer-scope writes — including ones made *after* the inner failure — intact once the outer transaction commits).

This matters because `writePick()` itself doesn't throw for an ordinary rejection (locked, canceled, postponed, invalid selection — all normal return values, not exceptions), so in the common case the savepoint does nothing observable. It exists as a defensive backstop for the case a design review of this feature actually caught before any code was written: the pre-existing `check_pick_selected_team` DB trigger (`0001_init.sql`) throws a real Postgres exception on an invalid `selectedTeam`. Without per-game isolation, one bad selection anywhere in a shared batch transaction would abort the *whole* transaction at commit time and silently roll back every other game's already-accepted pick — for a reason that has nothing to do with locking. Phase 1's pre-validation (above) already keeps a bad selection from ever reaching that trigger in the first place; the savepoint is what keeps the batch correct even if something entirely unanticipated goes wrong for one game.

## The slate endpoint

`GET /:leagueId/slate?date=YYYY-MM-DD` (date optional, defaults to "today" in the league's timezone) returns everything a client needs to render one day's games in a single request — the games, filtered to the league's sports; the caller's own picks; and, per game, a server-computed lock state and pick state, never a raw value for the client to evaluate itself.

**Day boundaries use the league's timezone**, via `dayBoundsUtc()` (`apps/api/src/lib/time.ts`) — Luxon, at the query boundary only, the same convention every other timezone-sensitive query in this app follows. Two members in different device timezones querying the same league on the same day see the same slate, because the day boundary was never computed from either of their devices.

**`locked` is computed in SQL** (`now() >= starts_at`), never in the application layer and never from anything the client sent — the same boundary `writePick`'s own gate enforces (`starts_at > now()` to accept), so a read from this endpoint can never disagree with what a write would actually decide a moment later. This endpoint is a read; it is never itself the enforcement — `writePick` always re-decides independently, every time, regardless of what a slate response said a moment ago.

**`pickState`** is computed server-side per game, one of five values (the literal five the requirements name): `unpicked`, `picked_open`, `locked`, `final_hit`, `final_miss`. A future client renders directly off this field rather than re-deriving the rule itself from `locked`/`myPick`/`winningTeam` separately — the same philosophy as `locked` itself, applied one level up.

## Privacy — enforced in the query, not after it

Requirement 5 is explicit that this must be a server-side filter, not a fetch-everything-then-hide-client-side approach — the latter leaks through the network tab immediately, and in a friends' league someone will look.

Per game, every *other* active member appears in `otherPicks` with `hasPicked` (always visible — you can always see who has already picked) and `selectedTeam` (only populated by the SQL itself once `locked` is true — never fetched and then filtered in application code). The caller's own selection (`myPick`) is always visible regardless of lock state, because it's their own data, not something being protected from them.

```sql
coalesce(
  json_agg(json_build_object(
    'leagueMemberId', lm.id,
    'displayName', u.display_name,
    'hasPicked', (p.id is not null),
    'selectedTeam', case when now() >= g.starts_at and p.id is not null then p.selected_team else null end
  )) filter (where lm.id != :callerMemberId),
  '[]'
)
```

Confirmed empirically that node-postgres auto-parses this `json_agg(json_build_object(...))` column into a real JS array of objects, not a string needing manual `JSON.parse` — another raw-SQL assumption checked against real Postgres rather than assumed.

## The audit trail

`pick_audit_log` (`0005_picks.sql`) records every accepted pick write — member, game, the selection written by *that* write, server timestamp, and whether it was a `create` or a `change` to an existing pick. It is genuinely append-only: `BEFORE UPDATE`/`BEFORE DELETE` triggers unconditionally `RAISE EXCEPTION`, so no application code path — not a bug, not a future feature, not a direct database session bypassing this app entirely — can alter or remove a row. `REVOKE` was considered and rejected: this app connects as a single table-owning DB role, and an owner bypasses ordinary privilege checks, so `REVOKE` would need a second, non-owner role to actually matter — real new infrastructure, not a migration-only change. Triggers are the same idiom already used for `check_pick_selected_team` and the commissioner invariant.

`GET /:leagueId/audit-log` (commissioner-only, cursor-paginated, optional `gameId`/`memberId` filters) is how "I definitely picked them" actually gets resolved — a queryable, tamper-proof record independent of `pick` itself, which only ever holds each member's *current* selection per game and would otherwise have no memory of what came before a change.

## The (unbuilt) slate UI — API contract only

This is still an API-only repo — no frontend exists anywhere in this codebase. Requirement 4's five visual states, countdown, and progress indicator are treated the same way every prior UI-shaped requirement in this app has been treated (the session-redirect contract, the stale-data-banner hook): document what the API provides, do not write UI code.

- **The five states** (`unpicked` / `picked_open` / `locked` / `final_hit` / `final_miss`) are the slate endpoint's `pickState` field directly — no client-side derivation needed.
- **A countdown to lock** needs the raw `startsAt` timestamp, which the slate response includes for exactly this reason — "don't return a raw timestamp for the client to evaluate" (requirement 1) is about the *authoritative accept/reject decision*, never substituting `locked` with something the client computes itself; it was never a requirement to hide `startsAt` outright, and a client can't render a matchup or a countdown without it.
- **Picks-made-of-total** is the slate response's `pickedCount`/`totalCount`.
- **"Transitions live without a refresh"** is a client polling/re-fetch-on-an-interval concern — re-requesting the slate near a game's `startsAt` will reflect the new `locked`/`pickState` immediately, since both are computed fresh on every request. No server-push mechanism (WebSocket, SSE) is built in this epic; if that becomes a real need later, it's a genuinely new capability to design, not an extension of what exists today.
