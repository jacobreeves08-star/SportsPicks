import * as Sentry from "@sentry/browser";
import { SENTRY_DSN } from "../api/config.js";

/**
 * Mirrors `apps/api/src/lib/error-tracking.ts` function-for-function
 * on purpose — same three exports, same no-op-when-unset guard on
 * EVERY one of them, not just `init`. `@sentry/browser` (not
 * `@sentry/react`) is the deliberate choice: `app-shell/ErrorBoundary.tsx`
 * is hand-built rather than using Sentry's own React integration, so
 * the React-specific bindings aren't needed, and the base SDK is
 * meaningfully lighter — this app's bad-wifi bundle-size constraint
 * (docs/design-system.md) applies here too.
 */
export function initErrorTracking(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN) return;
  Sentry.captureException(err);
}

export function captureMessage(message: string, extra?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return;
  Sentry.captureMessage(message, { level: "warning", extra });
}
