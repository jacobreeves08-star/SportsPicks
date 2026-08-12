import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Always resolve .env from the repo root, regardless of the process's cwd
// (npm workspace commands run with cwd = apps/api).
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SPORTS_API_PROVIDER: z.enum(["mock", "live"]).default("mock"),
  SPORTS_API_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),
  SPORTS_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SCORE_POLL_INTERVAL_CRON: z.string().default("*/5 * * * *"),
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
