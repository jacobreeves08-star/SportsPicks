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
  SPORTS_API_PROVIDER: z.enum(["mock", "live"]).default("mock"),
  SPORTS_API_BASE_URL: optionalUrl(),
  SPORTS_API_KEY: optionalString(),
  SCORE_POLL_INTERVAL_CRON: z.string().default("*/5 * * * *"),
  // Error tracking (JAC-11). Unset -> Sentry init is a no-op (e.g. dev).
  SENTRY_DSN: optionalUrl(),
  // Dead-man's-switch URL (e.g. a healthchecks.io check) pinged by the
  // score-poll job on every run. This is the DEDICATED job-failure alert:
  // it fires both when the job errors AND when the job simply never runs
  // at all, which plain error tracking can't detect. Unset -> ping is a
  // no-op (e.g. dev/CI).
  HEARTBEAT_URL: optionalUrl(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.SPORTS_API_PROVIDER === "live" && !parsed.data.SPORTS_API_KEY) {
    throw new Error("SPORTS_API_KEY is required when SPORTS_API_PROVIDER=live");
  }
  return parsed.data;
}

export const env = loadEnv();
