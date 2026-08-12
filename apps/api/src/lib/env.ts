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
