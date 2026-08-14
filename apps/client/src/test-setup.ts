import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect } from "vitest";

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

/**
 * `toHaveNoViolations()` for every design-system component test
 * (Epic 9). `vitest-axe` (the vitest-native package) was tried first
 * and rejected: its matcher genuinely doesn't register against this
 * repo's Vitest 4 — `expect(results).toHaveNoViolations()` threw
 * "Invalid Chai property," confirmed empirically with a throwaway
 * smoke test before committing to a package. `jest-axe`'s matcher is
 * just a plain object handed to `expect.extend`, with no runtime
 * coupling to Jest itself, and it registers cleanly here — same
 * "verify at install time, don't assume the peer range" discipline
 * this repo has already applied to every other library choice.
 */
expect.extend(toHaveNoViolations);

/**
 * jsdom doesn't implement `window.scrollTo` at all — TanStack
 * Router's scroll-restoration feature calls it on every navigation
 * (Epic 10, once real `RouterProvider`-based tests started rendering
 * the full route tree), which floods test output with "Not
 * implemented" errors that don't fail anything but bury real
 * signal. A no-op stub is the honest fix: this repo has no scroll
 * position to restore in a jsdom test environment anyway.
 */
window.scrollTo = () => {};
