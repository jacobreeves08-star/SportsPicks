import { buildApp } from "./app.js";
import { applyMigrations } from "./db/migrate.js";
import { ensurePlayerPool } from "./lib/ensure-player-pool.js";
import { initErrorTracking } from "./lib/error-tracking.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

/**
 * Boot order matters, and both halves of it are deliberate:
 *
 *  1. **Migrations, before the port opens.** Schema changes have to
 *     land before a single request can hit a table that doesn't exist
 *     yet. Doing this here rather than in a deploy hook is a
 *     concession to where this actually runs: a free Render instance,
 *     which has no Blueprint pre-deploy command, no cron services and
 *     no shell (all paid). Boot is the only hook available, and a
 *     schema change that depends on being run by hand is a schema
 *     change that eventually isn't — which is precisely how the daily
 *     quiz shipped to a database with none of its tables. `render.yaml`
 *     keeps its own pre-deploy command for a Blueprint-based
 *     deployment; the two are harmless together, since an
 *     already-applied migration is a no-op.
 *
 *     A failure here is fatal by design: the platform keeps the
 *     previous version serving, which is far better than a new one
 *     answering against a half-migrated schema.
 *
 *  2. **The player-pool check, after.** Fire-and-forget, never awaited
 *     — see lib/ensure-player-pool.ts for why it must not hold up the
 *     port opening.
 */
async function main(): Promise<void> {
  initErrorTracking();

  await applyMigrations();

  const app = buildApp();
  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ address }, "api listening");

  void ensurePlayerPool();
}

main().catch((err) => {
  logger.error({ err }, "failed to start api");
  process.exit(1);
});
