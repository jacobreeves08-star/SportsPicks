# Environments (JAC-10)

Three environments, each with its own database and credentials — never shared.

## dev — local, offline

- Runs entirely on your machine: `docker-compose` Postgres (`sports_pickem_dev`, throwaway local credentials in `docker-compose.yml`) + `npm run dev`.
- `SPORTS_API_PROVIDER=mock` by default (see `.env.example`) — both `schedule-ingest` and `score-poll` use `MockSportsProvider`, which returns canned/empty data and makes **zero** network calls. Nothing in local dev ever touches the real ESPN API, even if you run either job manually.
- Seeded via `npm run db:seed` — see `apps/api/src/db/seed.ts`. Not connected to Render at all; doesn't appear in `render.yaml`.
- `EMAIL_PROVIDER=mock` by default (JAC-13-18) — same idea as the sports provider: `MockEmailProvider` logs verification/reset links instead of sending, so local dev needs no Resend account and never sends real email.

## staging — Render, auto-deploy

- Services: `sports-pickem-api-staging`, `sports-pickem-schedule-ingest-staging`, `sports-pickem-score-poll-staging`, `sports-pickem-anonymize-staging`, database `sports-pickem-db-staging`.
- Tracks `main`, `autoDeploy: true` — every merge to `main` (once CI passes) deploys here automatically. This is what JAC-9's "auto-deploy on merge to main" refers to.
- `SPORTS_API_PROVIDER=live`. Unlike every other external dependency in this app, **ESPN needs no account, API key, or DNS setup at all** — it's a free, unauthenticated, undocumented endpoint (see `docs/adr/0003-sports-data-pipeline.md` for why it was chosen anyway, and the tradeoffs that come with no contract/SLA). `ESPN_API_BASE_URL` (`sync: false`) is present only as an optional override for pointing at a stub if ever needed; unset, the adapter falls back to the real ESPN base URL. Real integration testing against the real API happens here, not in dev.
- `EMAIL_PROVIDER=resend`, with its own `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` — see the Resend setup section below.
- Own isolated Postgres instance — nothing staging writes can affect prod data.

## prod — Render, manually promoted

- Services: `sports-pickem-api-prod`, `sports-pickem-schedule-ingest-prod`, `sports-pickem-score-poll-prod`, `sports-pickem-anonymize-prod`, database `sports-pickem-db-prod`.
- Also tracks `main`, but `autoDeploy: false` — a merge to `main` does **not** automatically hit prod. Once staging looks good, promote by triggering a manual deploy of the latest `main` commit from the Render dashboard (or `render deploy` via the CLI/API if you set that up later).
- This is a deliberate two-stage flow even for a solo maintainer, kept as simple as possible: one branch (trunk-based, per `CONTRIBUTING.md`), no separate `staging` branch to keep in sync — staging and prod both deploy from `main`, just on different triggers.
- Its own `RESEND_API_KEY` and Postgres instance, fully isolated from staging. No sports-API key to isolate — see above.

## Setting up Resend (staging/prod only — dev needs none of this)

1. Create a Resend account and add the domain you'll send from.
2. Resend gives you SPF and DKIM DNS records to add at your domain registrar — add both. Deliverability (JAC-15, and Epic 7's notifications depend on this) needs both records verified, not just the domain "added"; wait for Resend to show the domain as verified before relying on it.
3. Create an API key scoped to sending.
4. In the Render dashboard, set `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` (e.g. `"Sports Pick'em <noreply@yourdomain.com>"`) on both `sports-pickem-api-staging` and `sports-pickem-api-prod` — these are `sync: false` in `render.yaml`, so they only ever live in Render's dashboard, never in the repo. The two anonymize/score-poll cron services don't need these — they don't send email.
5. Verify staging first (trigger a signup against staging, confirm the email actually arrives) before considering prod ready.

## Database migrations

**Applied by the API itself, on boot** — `server.ts` awaits `applyMigrations()` before it opens its port. A failure is fatal, so the platform keeps the previous version serving rather than letting a new one answer against a half-migrated schema.

Boot, rather than a deploy hook, because of where this actually runs: the live deployment is a **free** Render instance created by hand in the dashboard, and pre-deploy commands, cron services, and shell access are all paid features. Boot is the only hook that exists there, and a schema change that depends on someone remembering to run it by hand is one that eventually doesn't get run — which is exactly how the daily college quiz reached production against a database with none of its tables.

`render.yaml` also sets `preDeployCommand` on its two web services, for a Blueprint-based deployment. The two are harmless together: an already-applied migration is a no-op.

Two things about that command that are easy to get wrong:

- It's `migrate` (`node dist/db/migrate.js`), **not** `db:migrate` (`tsx src/db/migrate.ts`). `tsx` is a devDependency and these services build with `NODE_ENV=production`, so it isn't installed there. `db:migrate` remains the right command locally and in CI.
- `tsc` copies no `.sql` files, so `apps/api/scripts/copy-migrations.mjs` copies `src/db/migrations` into `dist/db/migrations` as the last step of the build. Without it the compiled runner finds no migrations directory at all.

The cron services deliberately don't run migrations — they share the database with the web service and would only race it.

## The college quiz's player pool

Same constraint, same shape of answer. `nfl-athlete-ingest` is designed to run weekly as a cron service, but the free instance has no cron, so `lib/ensure-player-pool.ts` runs it once at startup **if the pool is completely empty** — fire-and-forget, after the port is open, with every failure swallowed and logged. It refreshes nothing and tops up nothing; one row is enough to skip it. A stale pool is fully playable, since a player's college never changes.

This needs `SPORTS_API_PROVIDER=live` in the environment. Under the `mock` default the provider returns an empty list, the pool stays empty, and the quiz correctly reports `TRIVIA_UNAVAILABLE` forever.

## Setting `PUBLIC_API_URL`

Used to build absolute links in emails (verification, password reset). This is a chicken-and-egg value — you don't know the real deployed URL until after the first deploy. Deploy first with the default (`http://localhost:3000`, harmless since email isn't live yet without `RESEND_API_KEY`), then once Render assigns the real staging/prod URLs, set `PUBLIC_API_URL` to each (`sync: false`) in the dashboard and redeploy.

## Why not a `staging` branch?

Keeping a long-lived `staging` branch would mean merging/rebasing it against `main` constantly, which contradicts the trunk-based model in `CONTRIBUTING.md` and adds ongoing busywork for a solo maintainer. Deploying the same `main` commit to two environments on two different triggers (auto vs. manual) gets the same safety property — "verify before it's live" — without a second branch to maintain.

## Setup (once you have a Render account and this repo is on GitHub)

1. Push this repo to GitHub (see `CONTRIBUTING.md` for the `gh repo create` command).
2. In Render: New → Blueprint → connect the repo → it reads `render.yaml` and creates all eight services (two web, six cron) + two databases.
3. No sports-API account or key setup needed — ESPN requires none (see above). If you ever want to point `ESPN_API_BASE_URL` at something other than the real ESPN base URL (e.g. a stub for testing), set it per-service in the Render dashboard (Environment tab); it's `sync: false` in `render.yaml` so it's never written to the repo, but it's optional and unset by default.
4. Follow the Resend setup steps above for both web services, and set `PUBLIC_API_URL` on both once you know the real deployed URLs.
5. Confirm `sports-pickem-api-prod`'s auto-deploy is off (Settings → Build & Deploy) before merging anything real.
