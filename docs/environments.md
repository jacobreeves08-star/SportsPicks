# Environments (JAC-10)

Three environments, each with its own database and credentials — never shared.

## dev — local, offline

- Runs entirely on your machine: `docker-compose` Postgres (`sports_pickem_dev`, throwaway local credentials in `docker-compose.yml`) + `npm run dev`.
- `SPORTS_API_PROVIDER=mock` by default (see `.env.example`) — the score-poll job uses `MockSportsProvider`, which returns `[]` and makes **zero** network calls. Nothing in local dev ever touches the paid sports API or burns quota, even if you run the score-poll job manually.
- Seeded via `npm run db:seed` — see `apps/api/src/db/seed.ts`. Not connected to Render at all; doesn't appear in `render.yaml`.
- `EMAIL_PROVIDER=mock` by default (JAC-13-18) — same idea as the sports provider: `MockEmailProvider` logs verification/reset links instead of sending, so local dev needs no Resend account and never sends real email.

## staging — Render, auto-deploy

- Services: `sports-pickem-api-staging`, `sports-pickem-score-poll-staging`, `sports-pickem-anonymize-staging`, database `sports-pickem-db-staging`.
- Tracks `main`, `autoDeploy: true` — every merge to `main` (once CI passes) deploys here automatically. This is what JAC-9's "auto-deploy on merge to main" refers to.
- `SPORTS_API_PROVIDER=live`, with its own `SPORTS_API_KEY` (set as a Render secret, not committed — `sync: false` in `render.yaml` means Render won't try to source it from anywhere but its own dashboard). Real integration testing against the real API happens here, not in dev.
- `EMAIL_PROVIDER=resend`, with its own `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` — see the Resend setup section below.
- Own isolated Postgres instance — nothing staging writes can affect prod data.

## prod — Render, manually promoted

- Services: `sports-pickem-api-prod`, `sports-pickem-score-poll-prod`, `sports-pickem-anonymize-prod`, database `sports-pickem-db-prod`.
- Also tracks `main`, but `autoDeploy: false` — a merge to `main` does **not** automatically hit prod. Once staging looks good, promote by triggering a manual deploy of the latest `main` commit from the Render dashboard (or `render deploy` via the CLI/API if you set that up later).
- This is a deliberate two-stage flow even for a solo maintainer, kept as simple as possible: one branch (trunk-based, per `CONTRIBUTING.md`), no separate `staging` branch to keep in sync — staging and prod both deploy from `main`, just on different triggers.
- Its own `SPORTS_API_KEY`, `RESEND_API_KEY`, and Postgres instance, fully isolated from staging.

## Setting up Resend (staging/prod only — dev needs none of this)

1. Create a Resend account and add the domain you'll send from.
2. Resend gives you SPF and DKIM DNS records to add at your domain registrar — add both. Deliverability (JAC-15, and Epic 7's notifications depend on this) needs both records verified, not just the domain "added"; wait for Resend to show the domain as verified before relying on it.
3. Create an API key scoped to sending.
4. In the Render dashboard, set `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` (e.g. `"Sports Pick'em <noreply@yourdomain.com>"`) on both `sports-pickem-api-staging` and `sports-pickem-api-prod` — these are `sync: false` in `render.yaml`, so they only ever live in Render's dashboard, never in the repo. The two anonymize/score-poll cron services don't need these — they don't send email.
5. Verify staging first (trigger a signup against staging, confirm the email actually arrives) before considering prod ready.

## Setting `PUBLIC_API_URL`

Used to build absolute links in emails (verification, password reset). This is a chicken-and-egg value — you don't know the real deployed URL until after the first deploy. Deploy first with the default (`http://localhost:3000`, harmless since email isn't live yet without `RESEND_API_KEY`), then once Render assigns the real staging/prod URLs, set `PUBLIC_API_URL` to each (`sync: false`) in the dashboard and redeploy.

## Why not a `staging` branch?

Keeping a long-lived `staging` branch would mean merging/rebasing it against `main` constantly, which contradicts the trunk-based model in `CONTRIBUTING.md` and adds ongoing busywork for a solo maintainer. Deploying the same `main` commit to two environments on two different triggers (auto vs. manual) gets the same safety property — "verify before it's live" — without a second branch to maintain.

## Setup (once you have a Render account and this repo is on GitHub)

1. Push this repo to GitHub (see `CONTRIBUTING.md` for the `gh repo create` command).
2. In Render: New → Blueprint → connect the repo → it reads `render.yaml` and creates all six services (two web, four cron) + two databases.
3. For each of `sports-pickem-api-staging` and `sports-pickem-api-prod` (and their matching score-poll cron jobs), set `SPORTS_API_KEY` and `SPORTS_API_BASE_URL` in the Render dashboard (Environment tab) — these are marked `sync: false` in `render.yaml` specifically so they're never written to the repo.
4. Follow the Resend setup steps above for both web services, and set `PUBLIC_API_URL` on both once you know the real deployed URLs.
5. Confirm `sports-pickem-api-prod`'s auto-deploy is off (Settings → Build & Deploy) before merging anything real.
