import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Integration tests share one real Postgres DB and truncate it in
    // beforeEach — running test files in parallel against that DB causes
    // real deadlocks and cross-file data races, not just flakiness.
    // Small suite, so running files sequentially costs little.
    fileParallelism: false,
  },
});
