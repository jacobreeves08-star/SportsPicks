# Privacy Policy

**DRAFT — not reviewed by counsel. Do not publish, present to users, or rely on this document as a real Privacy Policy until a licensed attorney has reviewed it.** This draft is written to match the system's actual, current behavior exactly — every retention and deletion claim below is derived directly from `docs/account-anonymization.md`, the authoritative engineering spec for what happens to account data, and from the actual schema and code as they exist today. **If this document and `docs/account-anonymization.md` ever disagree, the code is what actually happens — fix this document to match it, not the other way around**, per that document's own stated rule.

*Last drafted: this document has no effective date, because it has not been reviewed or published.*

## 1. What we collect

**Account data**, provided at signup or afterward: email address, a securely hashed password (never the plaintext password itself — see the Terms of Service), display name, IANA timezone (used to determine when your leagues' games lock and how times are shown to you), and an optional avatar URL.

**League and pick data**: the leagues you create or join, your role in each, and every pick you make. Every pick write is also recorded in an append-only audit log (`pick_audit_log`) — this is what resolves "I definitely picked them" disputes and is the record used to compute how promptly members complete their picks (see "Analytics," below).

**Operational data we do not treat as identifying**: rate-limiting counters (see `docs/rate-limiting-and-caching.md`) are ephemeral, in-memory, and never written to durable storage or associated with your account beyond the current time window. `job_run` records (when background jobs ran) and `analytics_event` rows (see "Analytics," below) are about system and product behavior, not about you personally.

We do **not** collect payment information, government ID, or date of birth — see the Terms of Service for the age-eligibility gap this implies, which is disclosed there rather than papered over here.

## 2. How we use it

To operate the Service: authenticate you, run your leagues' pick locks and scoring, compute standings, and — if you have notifications enabled — send you pick reminders and results summaries by email (see `docs/notifications.md`; you can turn these off globally or per league). We do not sell your data, and we do not use it for advertising — there is no advertising anywhere in this product.

## 3. Cookies and tracking

**This Service does not use cookies.** Authentication is handled with Bearer tokens sent in the `Authorization` header (see `docs/adr/0002-auth-session-hashing-email.md`), not cookies or browser storage the server sets. There are no third-party trackers, advertising pixels, or analytics SDKs of any kind embedded in this product.

**Analytics is entirely first-party and server-side** (`docs/analytics.md`): the server logs a small set of product events (account created, league created or joined, a pick submitted, a day's slate completed) directly to our own database as they happen on the server — never via a script running in your browser, and never sent to any third-party analytics platform. These events carry only IDs and non-identifying context (e.g., which game, which date) — never message content, never anything freeform you typed.

## 4. Data retention and deletion

You may request account deletion at any time. This begins a **grace period** (currently 30 days by default), during which simply logging back in cancels the deletion and your account continues exactly as before — no separate recovery process is needed. Once the grace period elapses, an automated process **anonymizes** your account:

| What happens to it | Data |
|---|---|
| **Permanently scrubbed** (the row still exists, but personal fields are replaced with non-identifying placeholders) | Your email, password, display name, and avatar |
| **Deleted outright** | Your login sessions, any pending email-verification tokens, and any push-notification device tokens |
| **Preserved, unchanged** | Your league memberships and every pick you ever made — this is what keeps historical standings correct for everyone else in your leagues, even after your account is anonymized. Also preserved: notification-idempotency records and analytics events tied to your (now-anonymized) account — both carry no personal data by design, so there is nothing left in them to scrub. |

We anonymize rather than delete your league/pick history outright because a league's standings depend on every member's picks staying in place — permanently deleting them would corrupt the results for everyone else in your leagues, including people who never asked for that. This tradeoff, and the exact mechanics above, are described in full technical detail in `docs/account-anonymization.md`, which this section is required to match exactly.

### What this policy does not cover

Being explicit about the edges, matching `docs/account-anonymization.md`'s own disclosure: a database backup taken before your deletion still contains pre-deletion data until that backup itself expires per our hosting provider's retention policy; an error-tracking event captured before deletion (if it happened to include identifying data) is not retroactively scrubbed; and our email provider's own delivery logs for messages sent to you before deletion are governed by that provider's retention policy, not this one.

## 5. Third parties

We share data with the following providers, only as needed to operate the Service:

- **Render** (hosting and database) — stores all the data described above.
- **Resend** (transactional email) — receives your email address and message content only when we send you an email (verification, password reset, pick reminders, results summaries). Governed by Resend's own privacy policy for anything beyond that.
- **Sentry** (error tracking) — may receive technical error details if something goes wrong; configured to avoid intentionally sending personal data, but see "What this policy does not cover" above for the disclosed limitation on pre-deletion error events.
- **A third-party sports data source** (see `docs/adr/0003-sports-data-pipeline.md`) — we send this provider game/date identifiers to fetch schedules and scores. We never send it anything about you personally.

We do not sell, rent, or otherwise disclose your personal data to third parties for their own marketing purposes.

## 6. Children's privacy

This Service is intended for use by individuals 18 and older, as a product policy — see the Terms of Service (item 2) for the disclosed gap that this is not currently verified at signup, and the plan to close it before wider launch.

## 7. Your rights

You can review and correct your account details, and request deletion, at any time through the account you're logged into. See "Data retention and deletion" above for exactly what deletion does and does not do to your data.

## 8. Changes to this policy

We may update this policy as the product changes; material changes will be communicated the same way as Terms of Service changes (item 11 there).

## 9. Contact

**Placeholder — a real contact method (support email or equivalent) must be added here before publication.**
