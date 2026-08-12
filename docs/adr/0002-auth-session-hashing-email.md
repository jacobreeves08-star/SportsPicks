# ADR 0002: Auth session strategy, password hashing, email provider

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Epic 2 (JAC-13–18) adds real authentication: signup, login/sessions, email verification and password reset, profile management, an authorization layer (membership/ownership/role checks — the part most worth getting right), and self-serve deletion with grace-period anonymization. Several genuine architectural decisions fall out of that: how sessions are represented and revoked, how passwords are hashed, how transactional email is sent, and how tokens transported. None of this was addressed by ADR 0001.

Two product-shaped constraints from the requirements directly drive the design below: the app is opened in 30-second bursts right before kickoff, so a forced re-login at that moment is the worst possible UX; and this is still a low-ops, solo-maintainer project (ADR 0001's framing carries forward unchanged).

## Decisions

### Opaque, DB-backed access + refresh tokens — not JWT

Both tokens are random, high-entropy opaque strings, hashed (sha256) and stored in a `session` table (`apps/api/src/db/schema.ts`). The access token is short-lived (`AUTH_ACCESS_TOKEN_TTL_MINUTES`, default 15). The refresh token has a **sliding** expiry (`AUTH_REFRESH_TOKEN_TTL_DAYS`, default 90) — every successful refresh extends it from *now*, not from the original issue time. This is what actually answers the "30-second burst before kickoff" requirement: as long as the user opens the app at least once within the sliding window, the client refreshes silently and they're never prompted to re-enter a password. The short access token keeps the blast radius of a leaked token small without trading away that UX.

JWTs were considered and rejected: they'd add a signing-key/secret-rotation story for no benefit here, and revocation (logout-everywhere, password-reset-invalidates-all-sessions) would still require a server-side check per request to be meaningful — at which point the "stateless" advantage of a JWT is gone anyway. Plain DB-backed opaque tokens make every revocation case (logout, logout-everywhere, password-reset, password-change-except-current-session, account-deletion) a single, obvious, immediately-effective `UPDATE`/`DELETE` — see `apps/api/src/lib/session.ts`.

**Deferred, not built:** refresh-token reuse detection (revoking a whole session "family" when an already-rotated-away token is presented again — a signal of theft). Right now a reused old refresh token just fails lookup, indistinguishable from any other invalid token. This is a known, real hardening step; not implemented this phase because it adds meaningful complexity (tracking token lineage) for a risk that's low at this app's current scale. Worth revisiting if the user base or threat model changes.

### Token transport: `Authorization: Bearer` + JSON bodies, not cookies

There is no frontend in this repo yet. Cookies would mean deciding on domain/CORS/CSRF handling now for a client that doesn't exist. Bearer tokens in JSON request/response bodies are trivial to test directly (`app.inject()` with an `authorization` header — see the JAC-17 test suite) and defer the cookie-vs-localStorage-vs-secure-storage decision to whichever frontend gets built, without changing anything about how sessions themselves work.

### Password hashing: Argon2id via `@node-rs/argon2`

Argon2id is the current OWASP-recommended default for password hashing. `@node-rs/argon2` specifically (not the `argon2` npm package) because it ships prebuilt native binaries — the `argon2` package requires a working node-gyp/C-toolchain to install, and this exact machine had real, time-consuming friction getting a native build environment (Docker Desktop, WSL2) working during Epic 1. Prebuilt binaries avoid repeating that for a dependency that every deploy needs. Parameters (`apps/api/src/lib/password.ts`) are OWASP's second recommended Argon2id configuration (19 MiB memory, 2 iterations, 1 thread) rather than the library's own lighter defaults — a deliberate balance for a small Render instance.

### Verification/session token hashing: plain sha256, no pepper

Both session tokens and email verification/reset tokens are hashed with sha256 before storage (`apps/api/src/lib/tokens.ts`). This is different from passwords on purpose: passwords are low-entropy, human-chosen secrets, which is exactly why they need a slow, adaptive, salted hash. These tokens are 256 bits of `crypto.randomBytes` — already at full entropy — so a fast cryptographic hash is sufficient to prevent a database leak from directly yielding usable tokens, and a pepper would add a secret-management burden for no measurable defense-in-depth gain here.

### Rate limiting: `@fastify/rate-limit`, in-memory store

Applied globally (100 req/min) plus tighter per-route limits (5/min) on signup, login, and password-reset-request — the endpoints where brute-force/enumeration matters most. The store is in-memory, which is fine for the single Render web service instance this app runs today, but **will not** coordinate rate limits across multiple instances if this is ever scaled horizontally — at that point a shared store (e.g. Redis) would be needed. Not built now; flagging so it isn't a surprise later.

### Email provider: Resend

Chosen over Postmark/SES/SendGrid for fit with the existing TypeScript-first stack (official `resend` SDK, simple API) and a workable free tier for a small app. Wired via the same mock/live provider-swap pattern as `apps/api/src/lib/sports-provider.ts` (`EMAIL_PROVIDER=mock|resend`, `apps/api/src/lib/email-provider.ts`) — dev and CI never send real email or need a Resend account; the mock provider logs the verification/reset link so it's directly usable from `npm run dev` output. Requires a verified sending domain (SPF/DKIM) in staging/prod — see `docs/environments.md` for the one-time setup steps, since that can't be done from this repo (it's a real DNS/account action on the maintainer's own domain).

## Consequences

- Losing a device's refresh token before it expires means it's usable by whoever has it for up to `AUTH_REFRESH_TOKEN_TTL_DAYS` (90 days) unless explicitly revoked — mitigated by logout-everywhere being one call, and by the reuse-detection gap above being a known, documented, revisitable limitation rather than an unnoticed one.
- Every authenticated request costs one DB lookup (session validation) — acceptable at this app's scale (a small friends-and-family pick'em app opened in short bursts, not a high-QPS service); would need reconsidering only alongside the rate-limit store if this ever needs horizontal scaling.
- The email pipeline (verification, password reset, deletion-related messaging) exists now specifically because Epic 7 (notifications) depends on deliverability already working — getting the sending domain/SPF/DKIM right here, once, rather than deferring it, per the original requirement.
