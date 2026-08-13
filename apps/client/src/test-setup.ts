import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Global test setup (vite.config.ts's `test.setupFiles`). This repo
 * doesn't enable Vitest's `globals: true` (matching apps/api's
 * convention of explicitly importing `describe`/`it`/`expect` from
 * "vitest" rather than relying on ambient globals), which means
 * @testing-library/react's own auto-cleanup — which only registers
 * itself when it detects a GLOBAL `afterEach` — never engages.
 * Without this, a `renderHook`/`render` from one test file's test
 * stays mounted into the next test in the same file: confirmed
 * empirically in offline/use-offline-queue.test.tsx, where a stale
 * mounted hook instance from an earlier test kept its
 * `window.addEventListener("online", ...)` listener alive and reacted
 * to a LATER test's dispatched event, inflating a call-count
 * assertion. `cleanup()` unmounts everything RTL rendered after every
 * test, closing that gap for every test file, not just that one.
 */
afterEach(() => {
  cleanup();
});
