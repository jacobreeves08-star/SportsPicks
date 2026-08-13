import react from "@vitejs/plugin-react";
// `vitest/config`'s defineConfig re-exports Vite's, with the `test` key
// already merged into the config type — importing `defineConfig` from
// plain `vite` here does NOT pick up `test`'s typing via the
// `vitest/config` triple-slash reference alone (confirmed: tsc rejected
// it), so this import is the actual fix, not just a style preference.
import { defineConfig } from "vitest/config";

// No TanStack Router codegen plugin here on purpose: routes are defined in
// code (src/routes/route-tree.ts), not file-based — this epic builds the
// route TREE and its param typing, deliberately with no page components
// yet (Epics 9-11 build screens). File-based routing's codegen step has
// nothing to scan for in a src/routes with no actual page files.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // e2e/ is Playwright, run via `npm run e2e`, never picked up by vitest.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
