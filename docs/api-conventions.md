# API conventions (JAC-12)

These apply to every endpoint this API ever grows. No product routes exist yet (foundations phase) — this document and the shared error handler in `apps/api/src/server.ts` are what future routes build on, not aspirational.

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

Implementation: `apps/api/src/lib/http-errors.ts` (`ApiError`, `toErrorResponse`), wired into Fastify's `setErrorHandler` in `server.ts`.

- Throw `new ApiError(code, message, statusCode, fields?)` from a route handler for any expected, client-facing failure (bad input, not found, conflict, etc.).
- Anything else that reaches the handler (a bug, a DB error, whatever) is treated as unexpected: the client gets a generic `500 INTERNAL_ERROR` with no internal detail, while the real error is logged and sent to error tracking (JAC-11). **Never** let a raw exception message or stack trace reach the client — that's how connection strings and internal paths leak.
- A Fastify JSON-schema validation failure (`err.validation`) is mapped automatically into the same envelope with `code: "VALIDATION_ERROR"` and one `fields` entry per failed field — route handlers don't need to do this by hand.
- Unmatched routes return `404 { "error": { "code": "NOT_FOUND", ... } }` via `setNotFoundHandler`, same envelope, no special case.

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

## Timestamps

Every timestamp in every request or response body is **ISO-8601, UTC, with a `Z` suffix**: `"2026-08-12T18:30:00.000Z"`. No naive timestamps, no numeric epoch, no server-local time, ever, in the wire format — this mirrors the DB-layer rule in `docs/data-model.md` (all storage/business logic in UTC) all the way out to the API boundary. Conversion to a user's or league's local timezone is a client/presentation concern, using `apps/api/src/lib/time.ts`'s helpers server-side if a response ever needs to include a pre-formatted local string (rare — prefer sending the UTC instant and letting the client format it).

Plain calendar dates with no time component (e.g. `league.season_start`) are the exception: `"2025-09-04"`, no time, no `Z` — they're not an instant, so there's nothing to convert.
