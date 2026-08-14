import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Always resolve .env from the repo root, regardless of the process's cwd
// (npm workspace commands run with cwd = apps/api).
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

// Treats an unset or blank env var as absent rather than a validation
// failure — `KEY=` in a .env file parses as "", not undefined.
const optionalUrl = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional());
const optionalString = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Sports data provider (JAC-20). ESPN's site API is free/unauthenticated
  // (see docs/adr/0003-sports-data-pipeline.md) — no key needed. The base
  // URL override exists only for pointing tests/local dev at a stub;
  // unset in every real environment, the adapter falls back to the real
  // ESPN endpoint.
  SPORTS_API_PROVIDER: z.enum(["mock", "live"]).default("mock"),
  ESPN_API_BASE_URL: optionalUrl(),
  // Error tracking (JAC-11). Unset -> Sentry init is a no-op (e.g. dev).
  SENTRY_DSN: optionalUrl(),
  // Dead-man's-switch URL (e.g. a healthchecks.io check) pinged by the
  // score-poll job on every run. This is the DEDICATED job-failure alert:
  // it fires both when the job errors AND when the job simply never runs
  // at all, which plain error tracking can't detect. Unset -> ping is a
  // no-op (e.g. dev/CI).
  HEARTBEAT_URL: optionalUrl(),
  // Separate from HEARTBEAT_URL on purpose (JAC-24): schedule-ingest runs
  // every 4 hours, not every 5 minutes — sharing one monitor would make
  // "did it run on time" meaningless for both jobs.
  SCHEDULE_INGEST_HEARTBEAT_URL: optionalUrl(),

  // Email provider (JAC-15). mock -> zero network calls, logs the link
  // instead (dev/CI never send real email or need a Resend account).
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  RESEND_API_KEY: optionalString(),
  EMAIL_FROM_ADDRESS: optionalString(),
  // Used to build absolute links in emails (verify/reset links).
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  // The client's own origin (Epic 8) — CORS (app.ts) allows exactly
  // this one origin, not a wildcard. Bearer-token auth (ADR 0002)
  // means no cookies ever cross this boundary, so `credentials` stays
  // false; this is purely what lets a real browser's CORS preflight
  // succeed for a client running on a different origin than the API.
  // Defaults to apps/client's own local-dev Vite port
  // (apps/client/src/api/config.ts's matching default), so the two
  // apps talk to each other with zero config out of the box.
  PUBLIC_CLIENT_URL: z.string().url().default("http://localhost:5173"),

  // Auth token lifetimes (JAC-14). Access token short-lived; refresh
  // token has a SLIDING expiry (extended on every rotation) so an
  // actively-returning user is never forced to re-authenticate — see
  // docs/adr/0002-auth-session-hashing-email.md.
  AUTH_ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),

  // Verification/reset token lifetimes (JAC-15).
  AUTH_EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  AUTH_EMAIL_CHANGE_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  // Self-serve deletion grace period (JAC-18) — see docs/account-anonymization.md.
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS: z.coerce.number().int().positive().default(30),

  // Separate from HEARTBEAT_URL on purpose: this job runs on a different
  // schedule (daily, not every 5 minutes), so sharing one monitor would
  // make its "did it run on time" signal meaningless for both jobs.
  ANONYMIZATION_HEARTBEAT_URL: optionalUrl(),

  // Leagues and membership (JAC-25-30). Global guardrails, not
  // per-league commissioner-configurable settings — see
  // docs/leagues-and-membership.md.
  MAX_LEAGUE_MEMBERS: z.coerce.number().int().positive().default(100),
  MAX_LEAGUES_PER_USER: z.coerce.number().int().positive().default(25),

  // How long after a game finalizes score-poll keeps re-checking it for
  // a provider-side revision (scoring reviews, forfeits, data errors —
  // JAC-40). Based on result.created_at, written exactly once at
  // insert — NOT game.updated_at, which gets bumped by routine,
  // unrelated writes (e.g. schedule-ingest correcting a team-name typo
  // on a long-final game) and would reopen this window for reasons that
  // have nothing to do with finalization. See docs/scoring-and-standings.md.
  REVISION_CHECK_WINDOW_HOURS: z.coerce.number().int().positive().default(48),

  // Launch readiness (JAC-43-48). Rate limiting — see
  // docs/rate-limiting-and-caching.md. Per-account global ceiling,
  // distinct from the existing IP-keyed global limit in app.ts: an
  // authenticated account hammering from rotating IPs would otherwise
  // never trip the IP-based limit at all.
  ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  // Per-member, not per-IP — a household sharing one IP shouldn't be
  // throttled together while one member is legitimately picking a full
  // slate.
  PICK_WRITE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),

  // Signup bot protection (JAC-43-48). Layered on top of the existing
  // 5/min-per-IP limit — that alone doesn't stop a bot from signing up
  // slowly and steadily all day. No CAPTCHA (no frontend exists to
  // render a challenge widget) — see docs/rate-limiting-and-caching.md
  // for the documented CAPTCHA contract for a future frontend.
  SIGNUP_DAILY_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),

  // Slate polling (JAC-43-48) — the underlying game data only changes
  // when an ingest job runs (score-poll every 5min at the fastest), so
  // a short cache dramatically cuts DB load from a client polling for
  // live lock transitions. See docs/rate-limiting-and-caching.md for
  // the cache-key design and its accepted staleness/single-process
  // tradeoffs.
  SLATE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(20),
  SLATE_POLL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),

  // Notifications (JAC-43-48) — see docs/notifications.md. How long
  // before a league's first lock of the day the pick-reminder job sends
  // — the send trigger itself is anchored to this absolute lead time
  // before the lock instant, timezone-independent by construction.
  REMINDER_LEAD_TIME_MINUTES: z.coerce.number().int().positive().default(60),
  PICK_REMINDER_HEARTBEAT_URL: optionalUrl(),
  RESULTS_SUMMARY_HEARTBEAT_URL: optionalUrl(),

  // Closed-beta observability (JAC-48) — see docs/notifications.md and
  // operator-digest.ts. Unset -> the digest job is a no-op with a
  // warning log, matching this app's "unset env var = no-op"
  // convention everywhere else (HEARTBEAT_URL, SENTRY_DSN, etc). A
  // single static recipient, not a table of subscribers — this is an
  // operator tool, not a user-facing feature.
  OPERATOR_EMAIL: optionalString(),
  OPERATOR_DIGEST_HEARTBEAT_URL: optionalUrl(),

  // Golf (JAC-56) — separate from every other heartbeat on purpose,
  // same reasoning as SCHEDULE_INGEST_HEARTBEAT_URL: golf-ingest runs
  // on its own schedule, distinct from every other job's.
  GOLF_INGEST_HEARTBEAT_URL: optionalUrl(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.EMAIL_PROVIDER === "resend" && (!parsed.data.RESEND_API_KEY || !parsed.data.EMAIL_FROM_ADDRESS)) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM_ADDRESS are required when EMAIL_PROVIDER=resend");
  }
  return parsed.data;
}

export const env = loadEnv();
