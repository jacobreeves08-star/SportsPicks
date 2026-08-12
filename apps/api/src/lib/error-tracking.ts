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
