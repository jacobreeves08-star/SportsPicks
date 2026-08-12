import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
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

main()
  .then(() => {
    logger.info("all migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "migration failed");
    process.exit(1);
  });
