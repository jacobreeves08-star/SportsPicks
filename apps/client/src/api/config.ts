/**
 * `VITE_API_BASE_URL` — Vite only exposes env vars prefixed `VITE_` to
 * client code (everything else is stripped at build time, deliberately
 * — see Vite's own docs on this; it's how a `.env` full of server
 * secrets never leaks into a shipped bundle). Defaults to the API's
 * local dev port (`apps/api`'s `PORT` default, `.env.example`) so
 * `npm run dev` works with zero client-side config out of the box.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/**
 * `VITE_SENTRY_DSN` — mirrors `apps/api`'s own `SENTRY_DSN` convention
 * exactly (`apps/api/src/lib/error-tracking.ts`): unset by default,
 * every client error-tracking call becomes a no-op rather than
 * throwing (`observability/error-tracking.ts`). Genuinely undefined
 * when unset — no fallback string — since there's no safe default
 * DSN the way there is for an API base URL.
 */
export const SENTRY_DSN: string | undefined = import.meta.env.VITE_SENTRY_DSN;
