import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applies every migration not yet recorded in `schema_migrations`, in
 * filename order, each in its own transaction. Idempotent and safe to
 * call repeatedly — an already-applied file costs one row read.
 *
 * Exported (not just run as a CLI) because `server.ts` calls it on boot:
 * the deployed environment this app actually runs in has no Blueprint,
 * no pre-deploy hook, and no shell (all paid Render features), so boot
 * is the only place migrations can reliably happen. Throws on the first
 * failure, which is what makes a bad migration abort startup rather
 * than leave the API serving requests against a half-migrated schema.
 */
export async function applyMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (await client.query<{ filename: string }>("select filename from schema_migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        logger.info({ file }, "migration already applied, skipping");
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), "utf8");
      logger.info({ file }, "applying migration");

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        logger.info({ file }, "migration applied");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Entry-point guard — the same one every job in src/jobs uses. Without
// it, `server.ts` importing `applyMigrations` would also run this CLI
// tail, and the process would try to migrate twice on every boot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyMigrations()
    .then(() => {
      logger.info("all migrations applied");
    })
    .catch((err) => {
      logger.error({ err }, "migration failed");
      // process.exitCode, not process.exit() — Pino's stdout writes are
      // async, and forcing an immediate exit can cut off this exact log
      // line before it flushes.
      process.exitCode = 1;
    });
}
