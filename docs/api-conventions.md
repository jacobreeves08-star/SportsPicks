# API conventions (JAC-12, extended by JAC-13–18)

These apply to every endpoint this API ever grows.

## Error envelope

Every non-2xx response is a single, consistent shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed validation",
    "fields": [
      { "field": "email", "message": "must be a valid email" }
    ]
  }
}
```

- `code` — a stable, machine-readable string (`SCREAMING_SNAKE_CASE`), safe for client code to branch on. Never changes wording; adding a new one is fine, renaming an existing one is a breaking change.
- `message` — a human-readable summary. Safe to show a developer; not guaranteed safe to show an end user verbatim.
- `fields` — optional, present for validation-style errors: which field(s), and what was wrong with each. Omitted entirely when not applicable (not `null`, not `[]`).

Implementation: `apps/api/src/lib/http-errors.ts` (`ApiError`, `toErrorResponse`), wired into Fastify's `setErrorHandler`/`setNotFoundHandler` in `apps/api/src/app.ts`.

- Throw `new ApiError(code, message, statusCode, fields?)` from a route handler for any expected, client-facing failure (bad input, not found, conflict, etc.).
- Anything else that reaches the handler (a bug, a DB error, whatever) is treated as unexpected: the client gets a generic `500 INTERNAL_ERROR` with no internal detail, while the real error is logged and sent to error tracking (JAC-11). **Never** let a raw exception message or stack trace reach the client — that's how connection strings and internal paths leak.
- A Fastify JSON-schema validation failure (`err.validation`) is mapped automatically into the same envelope with `code: "VALIDATION_ERROR"` and one `fields` entry per failed field — route handlers don't need to do this by hand.
- Unmatched routes return `404 { "error": { "code": "NOT_FOUND", ... } }` via `setNotFoundHandler`, same envelope, no special case.

Codes in use today:

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed schema or business validation; `fields` present |
| `UNAUTHENTICATED` | 401 | No/invalid/expired/revoked access token — always this one code regardless of which (JAC-14/17), see Authentication below |
| `INVALID_CREDENTIALS` | 401 | Login failed — always this one code whether the email doesn't exist or the password is wrong (JAC-14), never distinguished |
| `INVALID_REFRESH_TOKEN` | 401 | `/auth/refresh` given an invalid, expired, or already-rotated-away token |
| `CURRENT_PASSWORD_INCORRECT` | 401 | `/users/me/change-password` given the wrong current password |
| `INVALID_OR_EXPIRED_TOKEN` | 400 | An email-verification/email-change/password-reset link's token is invalid, expired, or already used |
| `FORBIDDEN` | 403 | Authenticated, but not authorized — failed a membership/ownership/role check (JAC-17) |
| `NOT_FOUND` | 404 | Unmatched route |
| `RATE_LIMITED` | 429 | `@fastify/rate-limit` tripped on the signup/login/password-reset-request routes — `toErrorResponse` special-cases its 429 into this code rather than the generic `REQUEST_ERROR` fallback |
| `REQUEST_ERROR` | 4xx | Generic fallback for a 4xx with no more specific code |
| `INTERNAL_ERROR` | 500 | Unexpected error; real detail never reaches the client |
| `INVITE_CODE_NOT_FOUND` | 404 | Invite code doesn't exist (JAC-25-30) |
| `INVITE_CODE_EXPIRED` | 410 | Invite code existed but is past its `expiresAt` |
| `INVITE_CODE_MAX_USES_REACHED` | 409 | The code's own `maxUses` is exhausted |
| `LEAGUE_FULL` | 409 | League at `MAX_LEAGUE_MEMBERS` |
| `MAX_LEAGUES_REACHED` | 409 | Caller at `MAX_LEAGUES_PER_USER`, on create or join |
| `SPORTS_SELECTION_FROZEN` | 409 | League already has a graded game; `sports` is immutable |
| `COMMISSIONER_MUST_TRANSFER_FIRST` | 409 | Sole commissioner tried to leave with other active members present |
| `SOLE_MEMBER_USE_DELETE` | 409 | Sole commissioner (and only member) tried to leave — delete the league instead |
| `CANNOT_REMOVE_SELF` | 400 | Commissioner targeted their own membership via remove-member — use leave/transfer/delete |
| `PICK_LOCKED` | 409 | The game has already started (JAC-31-36) — the single most important rejection code in the app; see `docs/picks-and-locking.md` |
| `GAME_CANCELED` | 409 | The game was canceled; no picks are ever accepted against it |
| `GAME_POSTPONED` | 409 | The game was postponed; picks reopen once schedule-ingest finds a real new time |
| `INVALID_TEAM_SELECTION` | 400 | `selectedTeam` isn't one of the game's two teams (or `'DRAW'` when the game doesn't allow it) |
| `GAME_NOT_FOUND` | 404 | `correct-result`'s `:gameId` doesn't exist, or its sport isn't part of the requesting league (JAC-37-42) |
| `RESULT_NOT_FOUND` | 404 | `correct-result` targets a game with no `result` yet — corrects an existing result, doesn't grade a new one |
| `NO_CHANGE` | 400 | `correct-result`'s `winningTeam` matches the current result — a no-op correction is rejected rather than recorded |

Offensive league-name rejection reuses `VALIDATION_ERROR` (`fields: [{ field: "name", ... }]`) rather than a bespoke code — same pattern as timezone validation in `users.routes.ts`/`auth.routes.ts`. A pick write against a nonexistent game, or a game whose sport isn't part of the league, also reuses `VALIDATION_ERROR` for the same reason — a malformed/invalid reference, not a distinct business rule the client needs to branch on differently. `PICK_LOCKED`/`GAME_CANCELED`/`GAME_POSTPONED`/`INVALID_TEAM_SELECTION` each get their own code because they *are* — see `apps/api/src/lib/pick-write.ts`'s `rejectionToApiError`. `correct-result`'s `winningTeam` failing the same "must be one of the game's two teams (or `'DRAW'`)" check also reuses `VALIDATION_ERROR`, for the identical reason.

## Authentication

Every protected route requires `Authorization: Bearer <accessToken>` (JAC-13-18) — not a cookie, see `docs/adr/0002-auth-session-hashing-email.md` for why. Applied per-route via a preHandler (`apps/api/src/plugins/authenticate.ts`), not a global hook, so it's explicit at each route rather than relying on an exclusion list.

Every reason an access token might not work — missing header, malformed header, unknown token, expired token, revoked token — produces the exact same `401 UNAUTHENTICATED`. This is deliberate: it gives a client exactly one thing to key off of ("not authenticated, go log in"), and it never leaks *why* a token didn't work, which would otherwise let someone probe whether a specific token value ever existed.

**Client contract for session expiry** (documented here, not implemented — there is no frontend in this repo yet): on receiving `401 UNAUTHENTICATED`, a client should first attempt `/auth/refresh` with its stored refresh token; if that also fails, redirect to login with a `?returnTo=<original path>` query param, and after a successful login, navigate back to that path. This keeps "redirect to login and return the user where they were" a client-side navigation concern, consistent with everything else about routing/rendering in this API-only repo.

## Pagination

Cursor-based, not offset/limit — offset pagination drifts under concurrent writes (a pick or standings update between page 1 and page 2 shifts every subsequent row), which matters for lists that change while someone's paging through them.

Request:

```
GET /leagues/:id/members?limit=25&cursor=<opaque>
```

- `limit` — optional, default and max defined per-endpoint (not globally — a picks list and a leagues list don't need the same cap).
- `cursor` — optional, opaque (don't parse or construct it client-side — treat it as a token). Omit for the first page.

Response:

```json
{
  "data": [ { "...": "..." } ],
  "pagination": {
    "next_cursor": "eyJpZCI6IjAxOTAi...",
    "limit": 25
  }
}
```

`next_cursor` is `null` when there's no next page.

`GET /leagues/:leagueId/picks` (JAC-17) doesn't follow this yet — it returns a bare array. That route exists only to give the authorization layer something real to test over HTTP (see `apps/api/src/routes/leagues.routes.ts`), not as the real picks-list endpoint; the real one, whenever the leagues/picks epic builds it, should follow this convention.

`GET /leagues/:leagueId/members` (JAC-25-30) is this convention's first real consumer. One implementation note worth flagging for the next paginated endpoint: the opaque cursor here encodes `(joinedAt, id)`, and the `WHERE` comparison against it needs `date_trunc('milliseconds', ...)` on **both** the cursor column and the `ORDER BY` — node-postgres's `timestamptz` parser produces a JS `Date` (millisecond resolution), but the column itself is stored with microsecond precision, so comparing the raw column against a millisecond-truncated cursor value lets a boundary row's real sub-millisecond remainder satisfy `>` against its own cursor and reappear on the next page. Caught by an integration test asserting the second page returns exactly the expected remainder, not one more.

`GET /leagues/:leagueId/audit-log` (JAC-31-36) is the second consumer, over `(createdAt, id)` — same `date_trunc('milliseconds', ...)` fix applied on both sides again, kept as its own small cursor-helper pair rather than generalizing the members-list one, so a two-call-site abstraction didn't risk touching already-verified pagination behavior.

## Timestamps

Every timestamp in every request or response body is **ISO-8601, UTC, with a `Z` suffix**: `"2026-08-12T18:30:00.000Z"`. No naive timestamps, no numeric epoch, no server-local time, ever, in the wire format — this mirrors the DB-layer rule in `docs/data-model.md` (all storage/business logic in UTC) all the way out to the API boundary. Conversion to a user's or league's local timezone is a client/presentation concern, using `apps/api/src/lib/time.ts`'s helpers server-side if a response ever needs to include a pre-formatted local string (rare — prefer sending the UTC instant and letting the client format it).

Plain calendar dates with no time component (e.g. `league.season_start`) are the exception: `"2025-09-04"`, no time, no `Z` — they're not an instant, so there's nothing to convert.
