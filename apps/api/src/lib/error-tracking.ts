import * as Sentry from "@sentry/node";
import { env } from "./env.js";

/**
 * No-op unless SENTRY_DSN is set (dev/CI run without it — see
 * .env.example). Call once, as early as possible in each entrypoint.
 */
export function initErrorTracking(): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export function captureException(err: unknown): void {
  if (!env.SENTRY_DSN) return;
  Sentry.captureException(err);
}

/**
 * A third alerting channel (JAC-24), alongside exception tracking and
 * heartbeats: for "the job succeeded, but something looks wrong"
 * anomalies — e.g. schedule-ingest finding zero games across every
 * tracked sport, or score-poll finding games well past their expected
 * end with no final result. Neither of those is a thrown error, so
 * captureException doesn't fit; they're not "job didn't run" either, so
 * a missed heartbeat wouldn't catch them.
 */
export function captureMessage(message: string, extra?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) return;
  Sentry.captureMessage(message, { level: "warning", extra });
}
