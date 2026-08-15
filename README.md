# Sports Pick'em

Daily straight-up picks against the spread of nothing — just who wins. Friends compare records inside leagues.

This repo covers foundations (repo, data model, CI, environments, observability, API conventions), authentication & identity (signup/login/sessions, email verification and password reset, profile management, the authorization layer, self-serve deletion), the sports data pipeline (schedule ingest, score polling, edge-case handling, failure alerting), leagues & membership (create/join/leave, invite codes, commissioner controls, the multi-league home screen), picks & lock enforcement (the daily slate, single/batch pick writes, server-enforced locking at game start, pick privacy, an append-only audit trail), scoring & standings (idempotent grading, ranked standings with a full tiebreaker chain, automatic and manual result correction, head-to-head comparison), launch readiness (pick-reminder and results-summary email notifications, self-built server-side analytics, layered rate limiting and slate-response caching, closed-beta operator observability, an accessibility spec, and draft legal documents), client infrastructure (a typed API client, server-time sync, a shared game-state model, TanStack Query with a rate-limit-aware polling policy, an optimistic pick-write hook with a revert that can't be made silent, an offline write queue, and a fully-typed deep-link route tree), and a design system (semantic design tokens, typography/layout primitives, the split pick control, result/state indicators, first-class loading/empty/error/stale components, and a Storybook gallery with an accessibility scan wired into CI — zero screens yet; that's Epics 10-11).

## Stack

- **Runtime:** Node.js 20 + TypeScript, [Fastify](https://fastify.dev/)
- **Database:** PostgreSQL, via [Drizzle ORM](https://orm.drizzle.team/)
- **Scheduling:** Render Cron Jobs (schedule ingest, score polling, account anonymization, pick reminders, results summaries, the daily operator digest)
- **Sports data:** ESPN's public site API (free, unauthenticated, no contract) — see [`docs/adr/0003-sports-data-pipeline.md`](docs/adr/0003-sports-data-pipeline.md) and [`docs/sports-pipeline.md`](docs/sports-pipeline.md).
- **Timezones:** [Luxon](https://moment.github.io/luxon/) — all storage/business logic in UTC, conversion only at presentation. See [`docs/adr/0001-stack-selection.md`](docs/adr/0001-stack-selection.md) for the full rationale.
- **Auth:** opaque DB-backed access/refresh tokens (not JWT), Argon2id password hashing, Resend for transactional email. See [`docs/adr/0002-auth-session-hashing-email.md`](docs/adr/0002-auth-session-hashing-email.md).
- **Hosting:** [Render](https://render.com/) — web services, cron jobs, managed Postgres, per-PR preview environments
- **Client:** React + Vite + TypeScript, [TanStack Query](https://tanstack.com/query) + [TanStack Router](https://tanstack.com/router), CSS Modules + [Storybook](https://storybook.js.org/) for the component library — `apps/client`, infrastructure and a design system so far (no screens). See [`docs/client-architecture.md`](docs/client-architecture.md) and [`docs/design-system.md`](docs/design-system.md).

## Local setup (clean machine)

Prerequisites: [Node 20+](https://nodejs.org/) (or use the version pinned in `.nvmrc` via `nvm use`), [Docker](https://www.docker.com/) for local Postgres.

```bash
git clone <repo-url>
cd sports-pickem
nvm use               # or ensure Node >=20.18.0 is active
npm install
cp .env.example .env  # defaults work as-is for local dev
docker compose up -d  # starts local Postgres on :5432
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api
npm run dev
```

The API is now running at `http://localhost:3000` (health check at `/health`, pipeline status at `/health/data-freshness`). By default `SPORTS_API_PROVIDER=mock` and `EMAIL_PROVIDER=mock`, so local dev never calls the real ESPN API or sends real email — see [`.env.example`](.env.example). With `EMAIL_PROVIDER=mock`, verification/reset links are logged to the dev server's output instead of emailed — grab them from there while testing signup/password-reset locally.

**Running the test suite requires local Postgres running** (`docker compose up -d` + `npm run db:migrate --workspace apps/api`, as above) — most tests are integration tests against a real database, not pure units.

To run a scheduled job manually (same commands Render's Cron Jobs run on a schedule):

```bash
npm run schedule-ingest --workspace apps/api
npm run score-poll --workspace apps/api
npm run golf-ingest --workspace apps/api
npm run nfl-athlete-ingest --workspace apps/api
npm run anonymize-accounts --workspace apps/api
npm run pick-reminder --workspace apps/api
npm run results-summary --workspace apps/api
npm run operator-digest --workspace apps/api
```

Note that `nfl-athlete-ingest` (the daily college quiz's player pool) does nothing while `SPORTS_API_PROVIDER=mock`, which is the local default — so a fresh dev database has an empty pool and the quiz correctly reports "no quiz today" until it's run against the real API. See [`docs/college-trivia.md`](docs/college-trivia.md).

### Running the client

```bash
cp apps/client/.env.example apps/client/.env  # defaults work as-is for local dev
npm run dev:client   # starts Vite on http://localhost:5173
```

The API must also be running (`npm run dev`, above) — the client talks to it over CORS, allowed via `PUBLIC_CLIENT_URL` in the API's own `.env` (defaults to the client's local port, so the two talk to each other with zero config out of the box). There are no screens yet (Epics 10-11 build them) — `npm run dev:client` is for exercising the infrastructure in `apps/client/src/` directly, e.g. via its test suite or the e2e harness below.

```bash
npm run test --workspace apps/client        # unit tests (Vitest), incl. jest-axe + WCAG contrast checks
npm run e2e --workspace apps/client          # Playwright, against the REAL api + client dev servers + Postgres
npm run storybook --workspace apps/client -- --host   # component gallery — add --host to view on a real phone
```

## Repo layout

```
apps/api/           Fastify API (routes, auth, authorization), scheduled jobs, DB schema/migrations/seed
apps/client/         React client infrastructure + design system (no screens yet) — see docs/client-architecture.md, docs/design-system.md
docs/adr/            Architecture decision records
docs/legal/          Draft Terms of Service and Privacy Policy — NOT reviewed by counsel
render.yaml           Render service definitions (web, cron, postgres) per environment
```

## Environments

Three isolated environments — dev (local, offline), staging, and prod — each with its own database and credentials. See [`docs/environments.md`](docs/environments.md).

## Observability

Structured logs, error tracking, uptime check, and the dedicated background-job-failure alert are documented in [`docs/observability.md`](docs/observability.md).

## API conventions

Error envelope, authentication, pagination, and timestamp format are documented in [`docs/api-conventions.md`](docs/api-conventions.md).

## Auth & identity

Signup, login/sessions, email verification and password reset, profile management, and the authorization layer are covered in [`docs/adr/0002-auth-session-hashing-email.md`](docs/adr/0002-auth-session-hashing-email.md) (design) and [`docs/api-conventions.md`](docs/api-conventions.md) (the `Authorization: Bearer` contract and error codes). Self-serve account deletion and anonymization behavior — what a future privacy policy must match exactly — is documented in [`docs/account-anonymization.md`](docs/account-anonymization.md).

## Sports data pipeline

Schedule ingest and score polling against the real ESPN API, canonical status/team mapping, exactly-once finalization, and the full postponed/cancelled/suspended/draw edge-case behavior are documented in [`docs/sports-pipeline.md`](docs/sports-pipeline.md) (behavior spec) and [`docs/adr/0003-sports-data-pipeline.md`](docs/adr/0003-sports-data-pipeline.md) (design decisions, including the JAC-19 provider evaluation).

## Leagues & membership

Creating a league, invite codes (generation, rotation, rate-limited redemption), join/leave/rejoin, commissioner controls (transfer, remove a member, delete the league, the sports-selection freeze), and the multi-league home screen's record/rank/unpicked-games computation are documented in [`docs/leagues-and-membership.md`](docs/leagues-and-membership.md).

## Picks & lock enforcement

The daily slate (day boundaries in the league's timezone), single and batch pick writes, why lock enforcement is safe against a rescheduled game and a manipulated client clock alike, per-game independence in the batch endpoint, server-side pick privacy, and the append-only pick audit trail are documented in [`docs/picks-and-locking.md`](docs/picks-and-locking.md).

## Scoring & standings

Idempotent grading (one point per correct winner, postponed/cancelled games voided for everyone), the fixed Tuesday–Monday week and full deterministic tiebreaker chain, automatic and manual result correction, and the standings/head-to-head API contract are documented in [`docs/scoring-and-standings.md`](docs/scoring-and-standings.md).

## Launch readiness

Pick-reminder and results-summary email notifications (idempotent per-member send, notification preferences, the DST-aware day-window logic), self-built server-side analytics (event log plus the ground-truth slate-completion-rate metric), layered rate limiting (per-account, per-route, signup bot protection) and slate-response caching, and closed-beta operator observability (`getOpsSummary()`, the enriched `/health/data-freshness`, and the daily operator digest email) are documented in [`docs/notifications.md`](docs/notifications.md), [`docs/analytics.md`](docs/analytics.md), and [`docs/rate-limiting-and-caching.md`](docs/rate-limiting-and-caching.md). The accessibility and responsive-design contract for a future frontend is in [`docs/accessibility-and-responsive.md`](docs/accessibility-and-responsive.md). Draft Terms of Service and Privacy Policy — **not reviewed by counsel, not for real use** — are in [`docs/legal/`](docs/legal/); the Privacy Policy's data-retention section is required to match [`docs/account-anonymization.md`](docs/account-anonymization.md) exactly.

## Client infrastructure

`apps/client` — a typed API client (built against [`docs/client-api-contract.md`](docs/client-api-contract.md), the ground truth read directly from the shipped API rather than assumed), server-time sync so countdowns stay correct against a real device clock, a single shared game-state model, TanStack Query with a rate-limit-aware polling policy, an optimistic pick-write hook whose revert can't be made silent by accident, an offline write queue that never implies a write succeeded before the server actually confirms it, and a fully-typed deep-link route tree. Zero screens — Epics 10-11 build those. Full design and module map in [`docs/client-architecture.md`](docs/client-architecture.md). Building this surfaced two real gaps in the API itself (no `X-Server-Time` signal, no CORS support at all) — both fixed and documented in the same place.

## Design system

`apps/client/src/design-system/` — semantic design tokens (verified against WCAG AA contrast by a dedicated test, not just eyeballed), typography/layout primitives with mandatory tabular numerals on every record/score/rank/countdown, the split pick control (a proper radio group, not two buttons — full keyboard nav, screen-reader announcements for all seven of its states), result/state indicators that never rely on color alone, and first-class loading/empty/error/stale components (stale is deliberately distinct from loading — known-old data shown anyway, not still fetching). Every component is pure and prop-driven, decoupled entirely from the client infrastructure above, so it's mockable in a Storybook gallery (`npm run storybook --workspace apps/client`) reviewable on a real phone. Accessibility is enforced in CI two ways — static lint (`eslint-plugin-jsx-a11y`) and a `jest-axe` scan per component/state — closing a real pre-existing gap where `apps/client`'s own test suite never ran in CI at all. Full design, the `PickControlState` contract, and two more real gaps found against the shipped API in [`docs/design-system.md`](docs/design-system.md).

## Daily college trivia

"Which college did this player attend?" — five NFL players a day, five colleges each. The first feature in the app that belongs to no league: playable with **no account at all** from the home page, or from a button on the leagues home after logging in, with results tracked against the profile (streak, accuracy, perfect days) for anyone signed in and a spoiler-safe shareable result either way. Building this is also what gave the app a real public home page — `/` was previously auth-guarded and bounced a stranger straight to `/login`. The shared-puzzle design (why everyone gets the same five players, why the correct answer never ships with the question, why the guest gate is honest about not being enforcement), the profile metrics, and the ESPN roster ingest are documented in [`docs/college-trivia.md`](docs/college-trivia.md).

## Branching & contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branching model and how `main` is protected.
