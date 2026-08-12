# Sports Pick'em

Daily straight-up picks against the spread of nothing — just who wins. Friends compare records inside leagues.

This repo covers foundations (repo, data model, CI, environments, observability, API conventions), authentication & identity (signup/login/sessions, email verification and password reset, profile management, the authorization layer, self-serve deletion), the sports data pipeline (schedule ingest, score polling, edge-case handling, failure alerting), leagues & membership (create/join/leave, invite codes, commissioner controls, the multi-league home screen), and picks & lock enforcement (the daily slate, single/batch pick writes, server-enforced locking at game start, pick privacy, an append-only audit trail).

## Stack

- **Runtime:** Node.js 20 + TypeScript, [Fastify](https://fastify.dev/)
- **Database:** PostgreSQL, via [Drizzle ORM](https://orm.drizzle.team/)
- **Scheduling:** Render Cron Jobs (schedule ingest, score polling, account anonymization)
- **Sports data:** ESPN's public site API (free, unauthenticated, no contract) — see [`docs/adr/0003-sports-data-pipeline.md`](docs/adr/0003-sports-data-pipeline.md) and [`docs/sports-pipeline.md`](docs/sports-pipeline.md).
- **Timezones:** [Luxon](https://moment.github.io/luxon/) — all storage/business logic in UTC, conversion only at presentation. See [`docs/adr/0001-stack-selection.md`](docs/adr/0001-stack-selection.md) for the full rationale.
- **Auth:** opaque DB-backed access/refresh tokens (not JWT), Argon2id password hashing, Resend for transactional email. See [`docs/adr/0002-auth-session-hashing-email.md`](docs/adr/0002-auth-session-hashing-email.md).
- **Hosting:** [Render](https://render.com/) — web services, cron jobs, managed Postgres, per-PR preview environments

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
npm run anonymize-accounts --workspace apps/api
```

## Repo layout

```
apps/api/           Fastify API (routes, auth, authorization), scheduled jobs, DB schema/migrations/seed
docs/adr/            Architecture decision records
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

## Branching & contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branching model and how `main` is protected.
