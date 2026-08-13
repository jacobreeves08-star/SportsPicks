# Account deletion & anonymization (JAC-18)

This is the authoritative spec for what actually happens when a user deletes their account. **A future privacy policy (Epic 7) must match this document exactly** — if the policy says something different from what the code does, the code is what actually happens to a user's data, so fix one to match the other rather than letting them drift.

## Why anonymization, not deletion

Hard-deleting a user row (or their `league_member`/`pick` rows) would corrupt historical standings for every other member of their leagues — a league's win/loss record depends on every member's picks staying in place, including a member who has since left or deleted their account. So a deleted account is **anonymized**, not erased: personal, identifying fields are permanently scrubbed, but the row structure that makes historical results reconcile is left intact.

## The two-step flow

### 1. Deletion request (immediate, self-serve)

`POST /users/me/deletion-request` (authenticated):

- Sets `user.deletion_requested_at` to the current time.
- Sets `user.scheduled_deletion_at` to `deletion_requested_at + ACCOUNT_DELETION_GRACE_PERIOD_DAYS` (default 30 days).
- Revokes **every** session for the account, including the one used to make this request — the user is logged out immediately.
- Does **not** touch `email`, `password_hash`, `display_name`, `avatar_url`, or any `league_member`/`pick` row. Nothing is anonymized yet.

### Recovery (during the grace period)

There is no separate token-based recovery flow. Logging back in with the account's normal email/password during the grace period is itself sufficient proof of identity — from there, `POST /users/me/deletion-cancel` clears `deletion_requested_at` and `scheduled_deletion_at` and the account continues exactly as before. Past the grace period (once `anonymized_at` is set), `deletion-cancel` returns an error — there's nothing left to cancel back to.

### 2. Anonymization (automatic, once the grace period elapses)

A daily cron job (`apps/api/src/jobs/anonymize-accounts.ts`, scheduled `0 3 * * *` in `render.yaml`) finds every user where `scheduled_deletion_at <= now()` and `anonymized_at is null`, and for each, in one transaction:

| Field | Becomes |
|---|---|
| `email` | `deleted-<user_id>@tombstone.invalid` (deterministic, permanently unique — never reused, never a real deliverable address) |
| `password_hash` | A freshly generated, well-formed Argon2id hash of a random value that is immediately discarded. The account can never log in again, but the column stays a valid hash rather than a sentinel/empty string, so nothing that assumes `password_hash` is always a real hash breaks. |
| `display_name` | `"Deleted User"` |
| `avatar_url` | `null` |
| `pending_email` | `null` (any in-flight email change is abandoned) |
| `anonymized_at` | Set to the current time — this is the permanent, idempotency-guaranteeing marker that this account has been processed. |

Also **deleted outright** (not anonymized, actually removed): every `session` row, every `verification_token` row, and every `push_token` row belonging to the user (JAC-43-48). None of these are historical records — they're device/channel state tied to an active account — and none have any bearing on historical standings.

### Explicitly preserved, never touched by this process

- The `user` row itself continues to exist (with the scrubbed fields above).
- Every `league_member` row — the user's league memberships, roles, and join dates stay exactly as they were.
- Every `pick` row — every pick they ever made stays attached to their (now-anonymized) `league_member` row, so past standings, win/loss records, and head-to-head history for every league they were in remain fully intact and correct.
- Every `notification_log` row (JAC-43-48) — a `(notification_type, league_member_id, notification_date)` idempotency marker with no personal data (no email, no message content), so there's nothing to scrub. It stays attached to the same `league_member` row picks do.
- Every `analytics_event` row (JAC-43-48) — see `docs/analytics.md`. `metadata` is populated only with IDs and non-identifying context by construction, never PII, so a row referencing an anonymized user's now-scrubbed account is expected and harmless, not a bug.

## Idempotency and failure handling

The job's query (`scheduled_deletion_at <= now() and anonymized_at is null`) means a user is only ever processed once — `anonymized_at` being set is what excludes them from future runs, even if the job runs again the same day or is retried after a partial failure. Each user is anonymized in its own database transaction, so one user's anonymization failing doesn't block or partially corrupt any other user's.

The job reports to error tracking on failure and pings a dedicated dead-man's-switch heartbeat (`ANONYMIZATION_HEARTBEAT_URL`, separate from the score-poll job's `HEARTBEAT_URL` since they run on different schedules) — see `docs/observability.md`.

## What this does *not* cover

Being explicit about the edges, so this document doesn't overstate what actually happens:

- **Error-tracking history.** If a pre-anonymization error event (Sentry) captured the user's real email or other identifying data before they deleted their account, that historical event is not retroactively scrubbed.
- **Database backups.** A backup taken before anonymization ran still contains the pre-anonymization data until that backup itself ages out per Render's retention policy.
- **Third-party email logs.** Resend's own delivery logs for emails sent to the user before deletion are governed by Resend's retention policy, not this app's.
