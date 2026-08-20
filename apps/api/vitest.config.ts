import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Integration tests share one real Postgres DB and truncate it in
    // beforeEach — running test files in parallel against that DB causes
    // real deadlocks and cross-file data races, not just flakiness.
    // Small suite, so running files sequentially costs little.
    fileParallelism: false,
    // Brings the test database's schema up to date before the suite
    // runs, so a dev whose test database is a migration behind gets
    // that told to them instead of a wall of "relation does not exist"
    // failures that look like broken tests.
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
