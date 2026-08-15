import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies `src/db/migrations/*.sql` into `dist/db/migrations` as the last
 * step of the API build.
 *
 * `tsc` compiles .ts files and copies nothing else, so without this the
 * directory `db/migrate.ts` reads at runtime simply doesn't exist in a
 * built artifact. That only bites in a DEPLOYED environment, which is
 * why it went unnoticed: locally and in CI, migrations run through
 * `npm run db:migrate` (tsx, straight off `src/`), but tsx is a
 * devDependency and Render builds with `NODE_ENV=production`, so the
 * only migration runner available there is the compiled one.
 *
 * Copied at build time rather than resolved back to `src/` at runtime so
 * `dist/` stays a self-contained deployable.
 */
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

cpSync(join(apiRoot, "src", "db", "migrations"), join(apiRoot, "dist", "db", "migrations"), {
  recursive: true,
});
