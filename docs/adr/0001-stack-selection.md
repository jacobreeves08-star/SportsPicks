# ADR 0001: Stack selection

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

We're building a sports pick'em app from scratch: users pick straight-up winners of daily games, records are compared against friends inside leagues. Score polling against a paid sports-data API must run reliably on a schedule. Timezone correctness (game start times, league timezones, user-local display) is core to the product, not incidental. A solo maintainer will operate this long-term.

Hard requirements for the stack:

1. A first-class scheduled-job / background-worker story — not a bare HTTP-triggered serverless function with execution-time limits and no retry/alerting model.
2. A mature timezone/date library.
3. A relational database.
4. Low operational burden for a solo maintainer.

## Options considered

**A — TypeScript on Render.** Node.js + Fastify API, PostgreSQL (Render-managed), Drizzle ORM, Luxon for timezones, Render Cron Jobs for score polling, Render Background Workers available if needed later. One dashboard for web service, cron, worker, and Postgres; built-in PR preview environments.

**B — Python on Fly.io.** Django or FastAPI, PostgreSQL, stdlib `zoneinfo` for timezones, Fly.io scheduled machines for score polling. Django's admin UI is a plus for solo-maintainer debugging; more manual (`flyctl`, `fly.toml`) than Render's dashboard-driven services.

Excluded outright: platforms whose only scheduling story is an HTTP-triggered serverless function (Vercel functions alone, Netlify, Cloudflare Workers alone) — these lack retry semantics, run-duration guarantees, and a dedicated failure-alerting path appropriate for a job whose silent failure (standings quietly stop updating) is the primary risk we're guarding against (see JAC-11).

## Decision

**Option A: TypeScript (Node.js + Fastify) + PostgreSQL + Drizzle + Luxon, hosted on Render.**

Render's Cron Jobs and Background Workers are first-class service types with their own logs and status, sitting next to the managed Postgres instance and the web service in one dashboard — the lowest operational surface area of the options considered for a solo maintainer. Luxon is a mature, widely-used IANA-timezone-aware library, sufficient for this app's needs (one timezone per user, one per league, UTC storage throughout — see `apps/api/src/lib/time.ts`). TypeScript end-to-end (API, scripts, migrations) avoids a second language/runtime to maintain.

## Consequences

- No built-in admin UI (unlike Django) — if ad hoc data inspection is needed later, it's a deliberate build, not free.
- Render's Postgres, cron, and worker pricing/limits become a de facto constraint on scaling; acceptable given the low-burden priority and can be revisited if the app outgrows it.
- All timestamps are stored and passed through business logic as UTC; conversion to a user's or league's IANA timezone happens only at the presentation boundary. This is enforced by convention in `apps/api/src/lib/time.ts`, not by a database constraint — worth revisiting if violations show up in review.
