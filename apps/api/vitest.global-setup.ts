import { applyMigrations } from "./src/db/migrate.js";

/**
 * Brings the test database's schema up to date once, before the suite runs.
 *
 * Here rather than in a documented manual step because the tests share one
 * real database and truncate it (see vitest.config.ts): a dev whose test
 * database is a migration behind doesn't get "your schema is stale", they
 * get a wall of "relation does not exist" failures that read as broken
 * tests. Idempotent — an already-migrated database costs one query — so
 * CI's explicit `db:migrate` step before this is simply a no-op the second
 * time round.
 *
 * Which database this touches is settled before we get here: env.ts loads
 * .env.test ahead of .env under Vitest and refuses to start at all unless
 * the database name ends in `_test`.
 */
export async function setup(): Promise<void> {
  try {
    await applyMigrations();
  } catch (err) {
    // 3D000 = database does not exist. Creating it here would be the wrong
    // fix: a test run should not bring databases into existence as a side
    // effect. Say what to run instead — the raw pg error names neither the
    // database nor the command.
    if ((err as { code?: string }).code === "3D000") {
      throw new Error(
        "The test database does not exist. Create it once with:\n" +
          "  docker compose exec postgres createdb -U postgres sports_pickem_test\n" +
          "(or point DATABASE_URL in .env.test at one that does — see CONTRIBUTING.md)",
      );
    }
    throw err;
  }
}
