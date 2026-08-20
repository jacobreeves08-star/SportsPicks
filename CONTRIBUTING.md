# Contributing

## Running tests locally

`npm test` requires local Postgres running (`docker compose up -d`). Most tests are integration tests against a real database (session lifecycle, authorization checks, full route flows via `app.inject()`), not pure units — this matches what CI's `test` job does against its own throwaway Postgres service container.

Those tests **truncate every table**, so they run against their own database and never the dev one. Create it once:

```bash
docker compose exec postgres createdb -U postgres sports_pickem_test
```

`.env.test` (committed — it holds no secrets) points `DATABASE_URL` at it, and `apps/api/src/lib/env.ts` loads that file ahead of `.env` whenever Vitest is running, so `npm test` picks it up with no extra flags. If the database name doesn't end in `_test`, the suite refuses to start rather than risk truncating a dev database. Migrations are applied automatically before the suite runs (`apps/api/vitest.global-setup.ts`) — there is no manual migrate step for tests.

Seeding (`npm run db:seed --workspace apps/api`) is separate and targets the dev database from `.env`.

## Branching model — trunk-based

- `main` is the only long-lived branch and is always deployable.
- Work happens on short-lived branches cut from `main`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Open a PR as soon as there's something to review; keep branches small and merge within a day or two — no long-running feature branches.
- Merge to `main` via squash merge once CI is green and the PR is approved. Delete the branch after merge.
- Every push to a PR branch gets a preview deploy (see CI, JAC-9); every merge to `main` auto-deploys to staging.

## Protecting `main`

`main` should be a protected branch on GitHub with, at minimum:

- Require a pull request before merging (no direct pushes, including for admins)
- Require status checks to pass before merging: `lint`, `typecheck`, `test`, `client`
- Require branches to be up to date before merging
- Require at least 1 approval (adjust to 0 if you're the sole reviewer, but keep the PR requirement)

This repo has no GitHub remote yet, so protection isn't configured. Once pushed:

```bash
gh repo create <org>/sports-pickem --source=. --private --push
gh api repos/<org>/sports-pickem/branches/main/protection \
  --method PUT \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=lint' \
  -f 'required_status_checks.contexts[]=typecheck' \
  -f 'required_status_checks.contexts[]=test' \
  -f 'required_status_checks.contexts[]=client' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.required_approving_review_count=0 \
  -f restrictions=null
```

(Or GitHub → Settings → Branches → Add branch protection rule for `main`, same settings.)
