# Leagues and membership (JAC-25–30)

This is the authoritative spec for how leagues, membership, invite codes, and the multi-league home screen actually behave. See [`docs/data-model.md`](data-model.md) for the schema and [`docs/api-conventions.md`](api-conventions.md) for the error codes. Routes live in `apps/api/src/routes/leagues.routes.ts` (CRUD, membership, reports, the home screen) and `apps/api/src/routes/league-invites.routes.ts` (invite-code lifecycle, preview, join).

## The commissioner invariant

`league.commissioner_id` (a single `NOT NULL` foreign key, present since JAC-8) is the one source of truth for who commissions a league — a single-valued column trivially guarantees "exactly one commissioner" by construction, with no uniqueness mechanism needed for it specifically.

`league_member.role` is a separate, stored, denormalized column (`'commissioner' | 'member'`, unchanged since JAC-8) that authorization code actually reads (`requireLeagueCommissioner`). It's kept in sync by a trigger, `sync_commissioner_role` (`AFTER UPDATE OF commissioner_id ON league`, `0004_leagues_membership.sql`), which demotes the old commissioner's row and promotes the new one whenever `commissioner_id` changes — i.e., on every transfer. A `GET DIAGNOSTICS row_count` check inside the trigger rejects the whole transaction if the new `commissioner_id` doesn't match exactly one active `league_member` row, which is what stops a buggy or malicious transfer target (not an active member of this league) from silently leaving the league with zero commissioners.

That trigger only fires on transfer. It does **not** cover league creation, where the app inserts the first `league_member` row itself in the same transaction as the `league` row — nothing ties those two writes together automatically. As a backstop for that gap (and for any future code that writes `league_member.role` directly, bypassing the trigger), there's a deferrable partial EXCLUDE constraint:

```sql
create extension if not exists btree_gist;

alter table league_member
  add constraint league_member_one_commissioner_per_league
  exclude using gist (league_id with =) where (role = 'commissioner' and left_at is null)
  deferrable initially deferred;
```

Two real Postgres constraints collide here and this is the one construct that satisfies both: a plain `UNIQUE INDEX` can have a `WHERE` clause (partial) but can never be `DEFERRABLE`; a `UNIQUE` table `CONSTRAINT` can be `DEFERRABLE` but can never have a `WHERE` clause. An `EXCLUDE` constraint can be both partial and deferrable — `DEFERRABLE INITIALLY DEFERRED` means it's only checked at `COMMIT`, which matters because the trigger's own two-statement fixup (demote, then promote) passes through a transient state within the same transaction that a non-deferred check would reject. `EXCLUDE` needs `btree_gist` because plain equality on a `uuid` column has no GiST operator class without it.

Covered directly against the database (not through routes) in `apps/api/src/db/league-commissioner-trigger.test.ts`.

## Soft leave and remove — and why rejoining restores prior picks

`league_member.left_at` (nullable) is set on both voluntary leave and commissioner-initiated removal — never a `DELETE`. "Active member" means `left_at is null`, everywhere: `requireLeagueMembership`, the home screen, the invite-preview member count, the `MAX_LEAGUE_MEMBERS` capacity check, and the standings ranking peer group all filter on it.

The existing `UNIQUE(user_id, league_id)` constraint on `league_member` (present since JAC-8, never dropped) does double duty here. Because a user can only ever have one `league_member` row per league for all time, the join flow's `INSERT ... ON CONFLICT (user_id, league_id) DO UPDATE SET left_at = null` is forced to reactivate that exact same row rather than create a second one. Since `pick.league_member_id` points at that row, not at the league directly, every pick that member ever made is still sitting right there the moment `left_at` clears — "rejoining restores prior picks" falls directly out of the schema, no special-case rejoin logic needed.

**No ban/block-rejoin list.** A member removed by the commissioner can rejoin via the invite code exactly like anyone else — removal stops participation *now*; it isn't a ban. `league_member_report` (below) gives the commissioner visibility without building a moderation system nothing asked for.

## Invite codes

One row per league (`league_invite_code`, `league_id UNIQUE`), created alongside the league at creation time. The code is 8 characters drawn from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — 26 letters minus I/L/O, digits 2–9 minus 0/1 (`apps/api/src/lib/invite-code.ts`) — excluding characters that get misread when spoken aloud in a group chat or mistyped on a phone keyboard. ~31⁸ (≈8.5×10¹¹) possible codes, generated via `crypto.randomInt` (unbiased).

"Rotatable" is satisfied by overwriting `code` and resetting `uses_count` on the same row — not a history table. `PATCH /:leagueId/invite-code` accepts `{ rotate?, maxUses?, expiresAt? }` in one call; regenerating the code is retried (up to 5 attempts) on the astronomically rare unique-constraint collision, same pattern used at league creation.

### Redemption is one atomic statement, not read-then-write

A naive implementation reads `uses_count`, checks it against `max_uses` in application code, and then writes — which is racy: two concurrent joins can both read `uses_count < max_uses` before either commits, both succeed, and the code ends up over its limit. The real join (`POST /leagues/join`) is a single statement instead:

```sql
with incr as (
  update league_invite_code
    set uses_count = uses_count + 1
    where code = $1
      and (expires_at is null or expires_at > now())
      and (max_uses is null or uses_count < max_uses)
      and (
        select count(*) from league_member
        where league_id = league_invite_code.league_id and left_at is null
      ) < $3  -- MAX_LEAGUE_MEMBERS
    returning league_id
)
insert into league_member (user_id, league_id, role)
select $2, league_id, 'member' from incr
on conflict (user_id, league_id) do update set left_at = null
returning id, league_id
```

The `UPDATE`'s row lock on that league's one `league_invite_code` row is what actually serializes concurrent redeemers — Postgres blocks the second transaction until the first commits, then re-evaluates the whole `WHERE` clause (EvalPlanQual) against the now-committed row. Because the `MAX_LEAGUE_MEMBERS` capacity check is a subquery embedded in that same guarded `UPDATE`, it gets the same protection for free: every join attempt for a given league contends on that league's single invite-code row, so two concurrent joins to a league sitting exactly one seat under capacity can't both slip through. Verified under real concurrent Postgres connections, not just reasoned about: `league-invites.routes.test.ts`'s race test fires two simultaneous joins at a `max_uses: 1` code and asserts exactly one succeeds and `uses_count` lands on exactly 1.

If the statement returns zero rows, a **follow-up** (unguarded) lookup on `league_invite_code` — paid only on this failure path, never on the common success path — determines which distinct error applies: `INVITE_CODE_NOT_FOUND` (404), `INVITE_CODE_EXPIRED` (410), `INVITE_CODE_MAX_USES_REACHED` (409), or `LEAGUE_FULL` (409) as the last remaining explanation.

`GET /leagues/preview?code=` runs the same unguarded lookup (no state change) so a client can show name/sports/member count and an `alreadyMember` flag before the user commits to joining.

**Rate limiting** on both `/preview` and `/join`, per requirement 6 ("per user AND per IP, so codes can't be brute-forced") — two genuinely independent limits, not one combined key: a tightened per-route `config.rateLimit` (20/min, inheriting the existing global per-IP `keyGenerator`) stacked with a second, explicit `preHandler: app.rateLimit({ keyGenerator: (req) => req.user.id, max: 10, timeWindow: "1 minute" })`. Verified against the installed `@fastify/rate-limit` source (not assumed) that these two constructs allocate separate internal stores rather than sharing counters.

## Sports-selection freeze

Confirmed with the user directly: a **hard, server-side freeze**, not a client-side-only warning. In this API-only repo (no frontend exists yet), a "warning" can only ever be a documented contract nothing actually enforces — the same category as the session-redirect and stale-data-banner contracts elsewhere in this codebase — whereas freezing is testable and real today. Once a league has any graded game, `PATCH /:leagueId` rejects a `sports` change with `409 SPORTS_SELECTION_FROZEN`:

```sql
select exists (
  select 1 from game
  where game.sport in (<league's current sports>)
    and game.starts_at >= (league.season_start::timestamp at time zone league.timezone)
    and exists (select 1 from result where result.game_id = game.id)
)
```

The explicit `AT TIME ZONE` cast matters: comparing `game.starts_at` (`timestamptz`) to `league.season_start` (a bare `date`) without it resolves using the *database session's* timezone, not the league's — precisely the per-viewer-timezone ambiguity `league.timezone` exists to eliminate, and a violation of this codebase's own rule that zone conversion happens only at the presentation boundary (`docs/data-model.md`). Computed on demand at write time — no stored "frozen" flag, and no coupling from `schedule-ingest`/`score-poll` (Epic 3) into the leagues feature; those jobs remain entirely unaware leagues exist.

## The multi-league home screen (`GET /leagues`)

Per active league membership: `record` (`wins`/`losses`), `gamesParticipated` (`wins + losses`), `rank` (standard competition ranking — ties share a rank number — by wins descending among the league's active members), `memberCount`, `unpickedCount`, and `nextLockAt`.

- A pick counts as a **win** when `pick.selected_team = result.winning_team`, a **loss** when it has a result and doesn't match. A pick on a still-ungraded game counts toward neither — `gamesParticipated` only grows once something is actually decided. Wins/losses deliberately do **not** re-filter by the league's *current* `sports` array: by the time anything is graded, the sports-selection freeze above already makes that moot, so re-checking it here would just be redundant work.
- `gamesParticipated` is always returned alongside the record, specifically so a mid-season joiner's smaller sample size is visible to whoever's looking (requirement 3's literal ask), rather than the server inventing an opinionated fairness-adjusted rank nobody asked for.
- `rank` is computed over **active members only** — a departed member left in the window would otherwise push everyone else's displayed rank down for no reason.
- `unpickedCount` / `nextLockAt`: games in the league's sports with `starts_at > now()` **and `starts_at < now() + pick_horizon_days`** and no pick row yet for that member; `nextLockAt` is the soonest such `starts_at`, or `null` if nothing's open. The horizon bound was added after real multi-week, multi-sport data made the previously-unbounded version genuinely misleading (a member seeing "176 unpicked" the moment two weeks of real schedule data landed) — see `pick_horizon_days` below.
- **Ordering** ("open picks + imminent locks first," requirement 5): leagues with `unpickedCount > 0` sort before leagues with none; within the "something open" group, soonest `nextLockAt` first; leagues with nothing open trail, sorted by name for stable output.
- Computed via two batched raw-SQL queries across every league the caller belongs to (not one query per league) — a `RANK() OVER (PARTITION BY league_id ...)` window query for records/rank/memberCount, and a separate grouped query for unpicked/nextLock, merged in application code. Not stored or cached.

**Pick horizon** (`league.pick_horizon_days`, integer, default 7, checked 1–30): how many days ahead a member can see a game as pickable at all — bounds both `unpickedCount`/`nextLockAt` above and the actual pick-write enforcement (`lib/pick-write.ts`, see `docs/picks-and-locking.md`). Commissioner-configurable via `PATCH /:leagueId`, same authorization as renaming the league. This closes the gap the original "deliberately out of scope" note below used to describe — write-time enforcement now exists, just narrower in scope than a full re-lock system: it only ever adds a NEW reason to reject a write (`PICK_BEYOND_HORIZON` → `409 PICK_NOT_YET_OPEN`), the existing past-the-start lock (`PICK_LOCKED`) is untouched.

**Still deliberately out of scope**: nothing beyond the two checks above. The horizon is a rolling window from "now," not calendar-day-aligned to the league's timezone (unlike the slate/day-bounds logic elsewhere in this app) — matching `PICK_LOCKED`'s own "as of this instant" framing, not a day-boundary concept the league's timezone would meaningfully change.

## Limits

| Limit | Env var | Default |
|---|---|---|
| Members per league | `MAX_LEAGUE_MEMBERS` | 100 |
| Leagues per user | `MAX_LEAGUES_PER_USER` | 25 |

Global guardrails, not per-league commissioner-configurable settings — matches this app's existing pattern for numeric limits (`ACCOUNT_DELETION_GRACE_PERIOD_DAYS`). Contrast with `pick_horizon_days` above, which is the first genuinely per-league, commissioner-configurable numeric setting in this codebase — a plain typed column on `league` itself (like `timezone`/`season_start`), not an env var.

**Offensive-name filtering** (`apps/api/src/lib/content-filter.ts`) is a small, static, word-boundary blocklist applied to league `name` on create and rename — explicitly *not* exhaustive, no ML, no third-party moderation service, matching this app's consistent zero-external-dependency-unless-necessary posture. A real abuse problem would need a real moderation API, not a bigger hand-maintained list; this is a documented known limitation, not a claim of completeness. Applied to league names only, not user display names (an already-shipped Epic 2 surface, out of this epic's scope).

**Member reporting** (`league_member_report`) is a visible list for the commissioner, not a moderation platform: no status/review workflow, no notification (Epic 7, notifications, doesn't exist yet). `POST /:leagueId/members/:memberId/report` (any active member, not against themselves) and `GET /:leagueId/reports` (commissioner-only).

## Commissioner controls — the leave/remove/transfer/delete edges

- **Leave** (`POST /:leagueId/leave`): if the caller is the commissioner and other active members remain, blocked with `409 COMMISSIONER_MUST_TRANSFER_FIRST`. If the caller is the commissioner and the *only* active member left, blocked with `409 SOLE_MEMBER_USE_DELETE` — directing them to delete the league instead of leaving, keeping "leave" and "delete" cleanly separate with no implicit auto-delete side effect. Otherwise, a plain soft leave.
- **Remove a member** (`DELETE /:leagueId/members/:memberId`, commissioner-only): `400 CANNOT_REMOVE_SELF` if the target is the commissioner's own membership — removing yourself is what leave/transfer/delete are for. Soft-removes the target otherwise; their picks are untouched.
- **Transfer** (`POST /:leagueId/transfer-commissioner`): the target must be an active member of this league (validated before the `UPDATE`, and enforced again by the trigger's `row_count` check regardless). A single `UPDATE league SET commissioner_id = ...` — the trigger does the rest.
- **Delete** (`DELETE /:leagueId`, commissioner-only): a real, hard, cascading delete — every pick belonging to the league's members, every `league_member`, `league_invite_code`, `league_member_report`, then the `league` row itself, all in one transaction. Safe to hard-delete here (unlike a single leaving member) because once the *entire* league is gone, there's no other member's standings left that depends on this history. `game`/`result` are global, shared across leagues, and completely untouched.
- Every one of these is a `requireLeagueCommissioner` or `requireLeagueMembership` call before anything else — a regular member gets a real `403 FORBIDDEN` over HTTP for every commissioner-only action, enforced server-side, never trusting a client to hide a button.

## Real bugs found during implementation (not caught by typecheck or lint)

Worth recording here, not just in a commit message, since they're the kind of gotcha someone will hit again the next time raw SQL touches these same patterns:

1. **drizzle's `sql` template tag flattens a plain JS array into an `IN`-list of individually-parameterized placeholders, not a single bound Postgres array.** `sql\`= any(${myArray})\`` silently binds only the array's first element and produces a `malformed array literal` error at best, wrong results at worst. Fixed everywhere by building an explicit `IN (...)` list with `sql.join(arr.map(v => sql\`${v}\`), sql\`, \`)`, or by using drizzle's `inArray()` query-builder helper where a plain delete/select sufficed instead of raw SQL.
2. **Postgres `bigint` aggregates come back from node-postgres as strings, not numbers**, unless explicitly cast. `rank()` and `count(*) OVER (...)` both needed `::int` casts in the raw SQL; without them, the home screen's `rank`/`memberCount` fields silently became `"1"` instead of `1`.
3. **Cursor pagination and sub-millisecond precision loss.** node-postgres's `timestamptz` parser produces a JS `Date`, which only has millisecond resolution — but the column itself stores microsecond precision. Comparing the raw column against a millisecond-truncated cursor value let a boundary row's real sub-millisecond remainder satisfy `>` against its own truncated cursor, so it reappeared on the next page. Fixed by wrapping **both** the `ORDER BY` and the cursor `WHERE` comparison in `date_trunc('milliseconds', ...)`, so both sides of the comparison operate at the same precision — truncating only one side (the obvious first fix to reach for) does not work.

All three were caught by writing and running a small standalone script against real Postgres (not fixtures, not mocks) when route tests returned unexplained `500`s or wrong data, then fixed and re-verified with dedicated integration tests before being folded back into the real route code.
