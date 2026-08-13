import { defineConfig, devices } from "@playwright/test";

/**
 * E2E harness (Epic 8 brief — the test that's hardest to retrofit
 * once real screens exist). Talks to the REAL API + REAL local
 * Postgres (docker compose), not a mock — see e2e/lock-transition.spec.ts
 * for why: the one thing worth an e2e test here is that the server's
 * own lock decision and the client's derived state genuinely agree,
 * which a mocked API can't prove.
 *
 * `webServer` starts both dev servers if they aren't already running
 * (`reuseExistingServer: true` locally — CI would want this false so
 * a stale server never masks a real startup failure).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev --workspace apps/api",
      cwd: "../..",
      url: "http://localhost:3000/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
