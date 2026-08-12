# Sports Pick'em

Daily straight-up picks against the spread of nothing — just who wins. Friends compare records inside leagues.

This repo currently covers **foundations only** (repo, data model, CI, environments, observability, API conventions). No product features yet.

## Stack

- **Runtime:** Node.js 20 + TypeScript, [Fastify](https://fastify.dev/)
- **Database:** PostgreSQL, via [Drizzle ORM](https://orm.drizzle.team/)
- **Scheduling:** Render Cron Jobs (score polling)
- **Timezones:** [Luxon](https://moment.github.io/luxon/) — all storage/business logic in UTC, conversion only at presentation. See [`docs/adr/0001-stack-selection.md`](docs/adr/0001-stack-selection.md) for the full rationale.
- **Hosting:** [Render](https://render.com/) — web service, cron job, managed Postgres, per-PR preview environments

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

The API is now running at `http://localhost:3000` (health check at `/health`). By default `SPORTS_API_PROVIDER=mock`, so local dev never calls the real (paid) sports-data API — see [`.env.example`](.env.example).

To run the score-poll job manually (same command Render's Cron Job runs on a schedule):

```bash
npm run score-poll --workspace apps/api
```

## Repo layout

```
apps/api/           Fastify API, score-poll job, DB schema/migrations/seed
docs/adr/            Architecture decision records
render.yaml           Render service definitions (web, cron, postgres) per environment
```

## Environments

Three isolated environments — dev (local, offline), staging, and prod — each with its own database and credentials. See [`docs/environments.md`](docs/environments.md).

## Observability

Structured logs, error tracking, uptime check, and the dedicated background-job-failure alert are documented in [`docs/observability.md`](docs/observability.md).

## API conventions

Error envelope, pagination, and timestamp format for the (future) HTTP API are documented in [`docs/api-conventions.md`](docs/api-conventions.md).

## Branching & contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branching model and how `main` is protected.
