# Client API contract (Epic 8 ground truth)

This document is the client's ground truth for the shipped API. It was written by reading `apps/api/src/routes/*.ts`, `apps/api/src/lib/http-errors.ts`, `apps/api/src/lib/pick-write.ts`, and `apps/api/src/app.ts` directly — not by re-describing `docs/api-conventions.md` from memory. Where the two disagree, this document defers to the code and says so. `apps/client/src/api/` is generated/hand-written against exactly what's below; if the backend changes, update this document first, then the client.

## Base contract (see `docs/api-conventions.md` for the full rationale)

- **Auth**: `Authorization: Bearer <accessToken>` on every protected route. No cookies. A missing/malformed/unknown/expired/revoked token is *always* `401 { error: { code: "UNAUTHENTICATED" } }` — one code, never a reason.
- **Error envelope**: `{ error: { code, message, fields?, retryAfterSeconds? } }` on every non-2xx response. `code` is the only thing client code should branch on.
- **Timestamps**: every timestamp in a body is ISO-8601 UTC with a `Z` suffix (`"2026-08-13T18:30:00.000Z"`). `league.seasonStart` is a bare date (`"2025-09-04"`, no time, no `Z`).
- **Pagination**: cursor-based. `GET ...?limit=25&cursor=<opaque>` → `{ data: [...], pagination: { next_cursor: string | null, limit } }`. Never construct or parse a cursor client-side.
- **CORS** (added this epic, `apps/api/src/app.ts`, `@fastify/cors`): the API allows exactly one origin, `env.PUBLIC_CLIENT_URL` (defaults to `http://localhost:5173`, the client's local dev port), no credentials (Bearer-token auth never needs cookies cross-origin), and explicitly lists every HTTP method any route in this app uses — **`@fastify/cors`'s own default `methods` list is `GET,HEAD,POST` only**, silently missing `PUT`/`PATCH`/`DELETE`. This was found the hard way: `curl` never performs a CORS preflight at all, so every manual `curl`-based check during this epic looked completely fine, while a real browser's preflight for the pick-write `PUT` route came back without `PUT` in `Access-Control-Allow-Methods` and the browser silently refused to ever send the actual request — surfaced only once the e2e harness (below) actually drove a real browser end to end. `X-Server-Time` is also explicitly added to `exposedHeaders` — a custom response header is invisible to browser JS on a cross-origin response unless CORS says otherwise, which would have silently broken the entire clock-sync module (`src/time/`) in any real browser despite the header genuinely being sent.
- **Server time header — `X-Server-Time`** (added this epic, `apps/api/src/app.ts`): every response, success or error, carries `X-Server-Time: <ISO-8601 UTC, millisecond precision>`, set in an `onSend` hook. This did **not** exist before this session — checked first (Node's implicit `Date` header is present on every HTTP response by default, but it's 1-second resolution, undocumented as part of this app's contract, and not something to depend on if an intermediary ever sits in front of the API). `apps/client/src/time/` is built against this header, not the implicit one.
- **Rate limiting**: a 429 carries `code: "RATE_LIMITED"` and, when available, `retryAfterSeconds` in the body (mirrors the `retry-after` header `@fastify/rate-limit` sets). Relevant ceilings for client polling design (`docs/rate-limiting-and-caching.md`, current defaults): account-wide 300/min, pick-write 30/min, **slate reads 20/min**, slate responses cached server-side for 20s. A client polling the slate faster than ~1/3s risks the limit; polling faster than the 20s cache TTL buys nothing (same cached response comes back).

## Endpoint catalog

Base path prefixes: `/auth`, `/users`, `/leagues` (three route files share this prefix), no prefix for `/health`.

### Auth (`/auth`, no `Authorization` header)

| Method & path | Body | Response | Notes |
|---|---|---|---|
| `POST /auth/signup` | `{ email, password (min 8), displayName, timezone (IANA) }` | `201 { message }` | Always this response, even on a duplicate email or a filled honeypot (`website` field) — never reveals which. |
| `POST /auth/login` | `{ email, password }` | `{ accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }` | `401 INVALID_CREDENTIALS` for both "no such account" and "wrong password." |
| `POST /auth/refresh` | `{ refreshToken }` | Same 4-field token shape as login | Rotates both tokens; the old refresh token stops working immediately. `401 INVALID_REFRESH_TOKEN` on failure. |
| `POST /auth/logout` | — (auth required) | `{ message }` | Revokes only the calling session. |
| `POST /auth/logout-all` | — (auth required) | `{ message }` | Revokes every session for the account. |
| `GET /auth/verify-email?token=` | — | `{ message }` | `400 INVALID_OR_EXPIRED_TOKEN` on a bad/used token. |
| `GET /auth/verify-email-change?token=` | — | `{ message }` | Same error code. |
| `POST /auth/password-reset/request` | `{ email }` | `{ message }` | Always the same response regardless of whether the account exists. |
| `POST /auth/password-reset/confirm` | `{ token, newPassword }` | `{ message }` | Revokes every session on success. |

`accessTokenExpiresAt`/`refreshTokenExpiresAt` are real ISO timestamps — a client should schedule a proactive refresh before expiry, not wait for a 401 (though the 401→refresh→retry flow must exist as the fallback regardless — see "Session-expiry contract" below).

### Users (`/users`, auth required)

| Method & path | Body | Response |
|---|---|---|
| `GET /users/me` | — | Profile: `{ id, email, displayName, timezone, avatarUrl, emailVerifiedAt, pendingEmail, deletionRequestedAt, scheduledDeletionAt, createdAt }` — **never** `passwordHash`. |
| `PATCH /users/me` | `{ displayName?, avatarUrl?, timezone? }` | Updated profile, plus `warning` string if `timezone` changed (picks lock relative to it). |
| `POST /users/me/email` | `{ newEmail }` | `{ message }` — always the same response; silently no-ops if the address is taken. |
| `POST /users/me/change-password` | `{ currentPassword, newPassword }` | `{ message }`. `401 CURRENT_PASSWORD_INCORRECT` on mismatch. Does **not** revoke the calling session. |
| `GET /users/me/export` | — | `{ profile, memberships: [...], picks: [...] }` |
| `GET /users/me/results-digest` | — | `{ leagues: [{ leagueId, leagueName, date, wins, losses, gamesParticipated, rank }] }` — the caller's own record for "yesterday" in each league (resolved per-league, in that league's own timezone). A league is omitted entirely if the caller had zero graded games there yesterday. See `docs/notifications.md`. |
| `POST /users/me/deletion-request` | — | `{ message, scheduledDeletionAt }`. Revokes every session, including the caller's own — **a client must treat this like a forced logout.** |
| `POST /users/me/deletion-cancel` | — | `{ message }`. `409 REQUEST_ERROR` if already anonymized. |

### Leagues (`/leagues`, auth required)

| Method & path | Body | Response |
|---|---|---|
| `POST /leagues` | `{ name, sports: string[], timezone?, seasonStart: "YYYY-MM-DD" }` | `201`, the created league + `memberCount: 1` + `inviteCode` (the raw code string). |
| `GET /leagues` | — | **Array** (not the paginated envelope) — the multi-league home screen. Each item: `{ id, name, sports, memberCount, record: { wins, losses }, gamesParticipated, rank, unpickedCount, nextLockAt }`, pre-sorted (leagues with something open first, soonest lock first; settled leagues trail, alphabetical). |
| `GET /leagues/:leagueId` | — | `{ ...league row, memberCount }`. |
| `PATCH /leagues/:leagueId` | `{ name?, sports? }` | Updated league. `409 SPORTS_SELECTION_FROZEN` if `sports` changes after the league has any graded game. Commissioner-only. |
| `DELETE /leagues/:leagueId` | — | `204`. Commissioner-only, hard-deletes the league and its picks. |
| `POST /leagues/:leagueId/transfer-commissioner` | `{ newCommissionerMemberId }` | `{ message }`. Commissioner-only. |
| `POST /leagues/:leagueId/leave` | — | `{ message }`. `409 COMMISSIONER_MUST_TRANSFER_FIRST` / `409 SOLE_MEMBER_USE_DELETE` if the caller is the commissioner. |
| `DELETE /leagues/:leagueId/members/:memberId` | — | `204`. Commissioner-only; `400 CANNOT_REMOVE_SELF` if targeting yourself. |
| `GET /leagues/:leagueId/members?limit=&cursor=` | — | Paginated envelope. Each row: `{ id, userId, displayName, role, joinedAt }`. |
| `POST /leagues/:leagueId/members/:memberId/report` | `{ reason }` | `201`, the created report. |
| `GET /leagues/:leagueId/reports` | — | Array. Commissioner-only. |
| `GET /leagues/:leagueId/audit-log?limit=&cursor=&gameId=&memberId=` | — | Paginated envelope. Commissioner-only. Rows: `{ id, leagueMemberId, displayName, gameId, selectedTeam, action: "create"\|"change", createdAt }`. |
| `GET /leagues/:leagueId/picks` | — | **Bare array**, not the pagination envelope. Per `docs/api-conventions.md`: this route exists only to give the authorization layer an HTTP-testable target and is **not** the real picks-list endpoint — do not build client UI against it. |

### Picks (`/leagues`, auth required, own rate limit on top of the account-wide one)

| Method & path | Body | Response |
|---|---|---|
| `PUT /leagues/:leagueId/members/:memberId/picks/:gameId` | `{ selectedTeam }` | The written pick: `{ id, leagueMemberId, gameId, selectedTeam, createdAt }`. `:memberId` **must** be the caller's own membership row (`403 FORBIDDEN` otherwise — enforced server-side, never trust a client-held memberId blindly, though in practice the client always has its own). |
| `POST /leagues/:leagueId/members/:memberId/picks/batch` | `{ picks: [{ gameId, selectedTeam }] }` (max 50) | `{ results: [{ gameId, status: "accepted"\|"rejected", pick?: { selectedTeam }, error?: { code, message } }] }` — **200 even when every item was rejected.** Never throws for an individual game's rejection; a client must inspect `results[].status` per item, not the HTTP status code. |

**Pick-write rejection reasons** (thrown as the single-pick route's error, or embedded per-item in the batch route): `PICK_LOCKED` (409 — the one to design UI around), `GAME_CANCELED` (409), `GAME_POSTPONED` (409), `INVALID_TEAM_SELECTION` (400), and a `VALIDATION_ERROR` (400) fallback for a nonexistent game or one whose sport isn't part of the league.

### Slate (`/leagues`, auth required, own rate limit, server-cached 20s per `(leagueId, date, viewerMemberId)`)

`GET /leagues/:leagueId/slate?date=YYYY-MM-DD` (date optional, defaults to today in the **league's** timezone):

```json
{
  "date": "2026-08-13",
  "games": [
    {
      "gameId": "...", "sport": "nfl", "homeTeam": "...", "awayTeam": "...",
      "startsAt": "2026-08-13T17:30:00.000Z",
      "status": "scheduled",
      "allowsDraw": false,
      "winningTeam": null,
      "locked": false,
      "myPick": null,
      "otherPicks": [{ "leagueMemberId": "...", "displayName": "...", "hasPicked": true, "selectedTeam": null }],
      "pickState": "unpicked"
    }
  ],
  "pickedCount": 0,
  "totalCount": 1
}
```

- `locked` is computed server-side (`now() >= starts_at`) — this is the exact boundary the write endpoint enforces, so display and enforcement never disagree at the margin, but **this field is a read, not the enforcement.** A write can still be rejected `PICK_LOCKED` even if the last-read `locked` was `false` a moment ago.
- `otherPicks[].selectedTeam` is `null` until `locked` is `true` for that game — enforced in the query itself, not filtered client-side. Never expect to see another member's selection early.
- `myPick` is always visible regardless of lock state (it's the caller's own data).
- `pickState` is the **authoritative** per-game/per-viewer UI state, one of exactly five values: `unpicked`, `picked_open`, `locked`, `final_hit`, `final_miss`. This is a *different* enum from the client-side `GameState` this epic builds (`apps/client/src/game-state/`) — `pickState` bakes in the caller's own pick outcome, `GameState` describes the game itself, independent of viewer. Both are legitimate; don't conflate them.

### Standings and head-to-head (`/leagues`, auth required)

| Method & path | Response |
|---|---|
| `GET /leagues/:leagueId/standings?timeframe=today\|week\|season&date=` | `{ timeframe, date, callerLeagueMemberId, standings: [{ leagueMemberId, userId, displayName, wins, losses, gamesParticipated, winPct, rank, rankChange }] }`. `rankChange` is `null` for `season` (no natural prior period) and for a member unranked in the prior period. |
| `GET /leagues/:leagueId/head-to-head?date=` | `{ date, games: [{ gameId, homeTeam, awayTeam, startsAt, winningTeam, picks: [{ leagueMemberId, displayName, selectedTeam, hit }], split, allWrong }] }`. **Only locked games appear at all** — an unlocked game is omitted entirely, not just its picks hidden. |
| `POST /leagues/:leagueId/games/:gameId/correct-result` | `{ winningTeam, reason }` → `{ correction, affectedMembers }`. Commissioner-only. |
| `GET /leagues/:leagueId/corrections?limit=&cursor=` | Paginated envelope of `result_correction` rows. |

### Invite codes (`/leagues`, auth required, tight per-user rate limit on preview/join)

| Method & path | Body | Response |
|---|---|---|
| `GET /leagues/:leagueId/invite-code` | — | `{ code, deepLink, maxUses, usesCount, expiresAt }`. Commissioner-only. **See "Known contract gap" below — `deepLink` is not currently usable as-is.** |
| `PATCH /leagues/:leagueId/invite-code` | `{ rotate?, maxUses?, expiresAt? }` | Updated invite-code row. |
| `GET /leagues/preview?code=` | — | `{ name, sports, memberCount, alreadyMember }`. `404 INVITE_CODE_NOT_FOUND`, `410 INVITE_CODE_EXPIRED`, `409 INVITE_CODE_MAX_USES_REACHED`. |
| `POST /leagues/join` | `{ code }` | `{ leagueId, leagueName }`. Same error codes as preview, plus `409 LEAGUE_FULL`. |

### Health (no prefix, no auth) — not for client UI, ops-only

`GET /health` → `{ status: "ok" }`. `GET /health/data-freshness` → job/analytics ops snapshot (`docs/notifications.md`/`docs/analytics.md`), not part of the product surface.

## Session-expiry contract (already documented in `docs/api-conventions.md`, restated here as what the client actually implements)

On `401 UNAUTHENTICATED`: attempt `POST /auth/refresh` with the stored refresh token once; if that also fails, treat the session as dead — clear stored tokens, navigate to login with `?returnTo=<current path>`, and after a successful login navigate back to that path. This is exactly what `apps/client/src/api/`'s client does; no screen should hand-rolls its own 401 handling.

## Known contract gaps found while reading the code (flagged per instruction, not silently worked around)

1. **`GET /leagues/:leagueId/invite-code`'s `deepLink` field points at the API host, not a client host** — it's built as `` `${env.PUBLIC_API_URL}/join?code=${code}` `` (`league-invites.routes.ts`), and there is no `PUBLIC_CLIENT_URL`-equivalent env var anywhere in `apps/api/src/lib/env.ts`. As shipped, this field is not a usable deep link into whatever client gets built — the API server doesn't serve client routes. This is a backend gap, out of this session's "client infrastructure only" scope to fix; flagging it rather than silently working around it in the client. The client's own route tree (`apps/client/src/router.ts`) is built against the *shape* the code implies (`code` as a query param: `/join?code=XXXX`) plus the path-param form the user's own spec asked for (`/join/:inviteCode`) — see that module's comment for how both are reconciled.
2. **Postponed games are not purely a "reschedule" case** — the client-facing task description lists `SCHEDULED→SCHEDULED (reschedule, new start time)` and `SCHEDULED|LOCKED→VOID (cancelled)` as the only two non-lock/non-final transitions. Reading `apps/api/src/lib/grading.ts` and `schedule-ingest.ts` directly: a game transitioning to `postponed` gets every ungraded pick **voided immediately** (`docs/scoring-and-standings.md`: "postponed/cancelled games are voided for everyone, never counted as a loss") — the same VOID treatment as cancellation, not a same-state reschedule. The difference from cancellation: `schedule-ingest.ts` has an **unbounded recovery pass** that keeps re-checking every `postponed` game for a real new time and flips it back to `scheduled` (a fresh `startsAt`) if one appears — cancellation has no such recovery path and is terminal. The client's `GameState` module (`apps/client/src/game-state/`) treats both `postponed` and `canceled` as `VOID` (matching the user's one-enum request) but tracks a `reason: "postponed" | "canceled"` on the variant, and encodes `VOID(postponed) → SCHEDULED` as a legal transition (`VOID(canceled)` has none) — this is a real, shipped behavior the original transition list didn't account for, so the code's actual state graph is followed here, not the original bullet list.
