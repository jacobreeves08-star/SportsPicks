# Contributing

## Branching model — trunk-based

- `main` is the only long-lived branch and is always deployable.
- Work happens on short-lived branches cut from `main`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Open a PR as soon as there's something to review; keep branches small and merge within a day or two — no long-running feature branches.
- Merge to `main` via squash merge once CI is green and the PR is approved. Delete the branch after merge.
- Every push to a PR branch gets a preview deploy (see CI, JAC-9); every merge to `main` auto-deploys to staging.

## Protecting `main`

`main` should be a protected branch on GitHub with, at minimum:

- Require a pull request before merging (no direct pushes, including for admins)
- Require status checks to pass before merging: `lint`, `typecheck`, `test`
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
  -f enforce_admins=true \
  -f required_pull_request_reviews.required_approving_review_count=0 \
  -f restrictions=null
```

(Or GitHub → Settings → Branches → Add branch protection rule for `main`, same settings.)
