# Observability (JAC-11)

Four pieces. The most important one is the last — read that section first if you're skimming.

## Structured logs with request IDs

Fastify's built-in logger is wired to `apps/api/src/lib/logger.ts` (Pino, JSON, level from `LOG_LEVEL`). `server.ts` sets `genReqId` to reuse an incoming `x-request-id` header or generate one, and Fastify automatically logs `"incoming request"` / `"request completed"` for every request tagged with that `reqId` — so every log line for a given request can be correlated. Nothing product-specific to add yet; any future route handler gets this for free via `request.log`.

## Error tracking

`apps/api/src/lib/error-tracking.ts` wraps Sentry (`@sentry/node`). `initErrorTracking()` is called at the top of `server.ts` (paired with a Fastify `setErrorHandler` in `app.ts` that reports uncaught 5xx request errors) and at the top of every scheduled job's entrypoint block (`score-poll.ts`, `anonymize-accounts.ts`). It's a no-op unless `SENTRY_DSN` is set — dev and CI run with it unset, so nothing ever gets sent from a laptop or a test run. Set `SENTRY_DSN` per-environment in the Render dashboard (staging and prod should be separate Sentry projects, or at least tagged by `environment`, so a staging error doesn't page you as if it were prod).

## Uptime check

External, not something running inside this repo. Point an uptime monitor (UptimeRobot, Better Uptime, Pingdom — any of them) at `https://<prod-domain>/health` on a 1–5 minute interval, alerting on non-200 or timeout. This is a one-time manual setup step in whichever service you pick — there's no API key to wire into the app for this one, it just hits the public endpoint.

## The dedicated background-job-failure alert — this is the one that matters

Score polling is a scheduled job with no user directly watching it. If it silently stops running — the cron misfires, the process hangs, a dependency starts failing — nothing about the rest of the app looks unhealthy. The web service still returns 200 on `/health`. No user-facing error occurs. Standings just quietly stop updating, and the first person to notice is a confused user, possibly days later.

A plain `try/catch` + error tracker does **not** cover this. It only reports a failure if the job runs and throws. If Render's cron trigger itself misfires, or the process hangs and never reaches the catch block, error tracking sees nothing — because nothing ran.

The fix is a **dead-man's-switch / heartbeat monitor** (`apps/api/src/lib/heartbeat.ts`), pointed at a service like [healthchecks.io](https://healthchecks.io/) (has a free tier, purpose-built for exactly this):

- On every successful run, the job pings its monitor URL.
- On every failure, it pings `<url>/fail` (healthchecks.io's convention for "explicitly failed").
- If the monitor **doesn't hear from the job at all** within the expected window (configure the monitor's period slightly longer than the job's actual schedule), it alerts you on its own — this is what catches the "job silently stopped running entirely" case that error tracking can't.

`pingHeartbeat(url, status)` takes the monitor URL as a parameter rather than reading one fixed env var — every scheduled job gets its **own** monitor URL, not a shared one:

| Job | Env var | Schedule |
|---|---|---|
| `score-poll` | `HEARTBEAT_URL` | every 5 minutes |
| `anonymize-accounts` (JAC-18) | `ANONYMIZATION_HEARTBEAT_URL` | daily |

Sharing one monitor between two jobs on two different schedules would make "did it run on time" meaningless for both — a monitor configured for a 5-minute window would falsely alert on the daily job between its runs, and one configured for a day would never notice the 5-minute job going quiet for hours.

Setup: create a separate check at healthchecks.io (or equivalent) per job, set each one's expected period to match that job's actual schedule, and put its ping URL in the corresponding env var for the staging and prod cron services in the Render dashboard. Unset in dev/CI — the ping becomes a no-op either way (see `.env.example`).

This is deliberately a separate, dedicated channel from general error tracking — the whole point is that it fires even when nothing else does.
