import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./use-reduced-motion.js";

/**
 * jsdom doesn't implement `matchMedia` at all — every test here
 * installs a fake `MediaQueryList` with a controllable `.matches` and
 * a real listener registry, so `change` events can be dispatched
 * exactly like a browser would when the OS setting flips mid-session.
 */
function installFakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      listeners.add(handler);
    }),
    removeEventListener: vi.fn((_event: string, handler: () => void) => {
      listeners.delete(handler);
    }),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);

  return {
    setMatches: (next: boolean) => {
      matches = next;
      listeners.forEach((handler) => handler());
    },
    mql,
  };
}

describe("useReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("reflects the initial OS preference", () => {
    installFakeMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("defaults to false when the preference is off", () => {
    installFakeMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates live when the OS preference changes mid-session", () => {
    const { setMatches } = installFakeMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });
    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    const { mql } = installFakeMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

describe("useReducedMotion without matchMedia support", () => {
  let beforeEachOriginal: typeof window.matchMedia;

  beforeEach(() => {
    beforeEachOriginal = window.matchMedia;
    // @ts-expect-error — simulating an environment with no matchMedia at all.
    window.matchMedia = undefined;
  });

  afterEach(() => {
    window.matchMedia = beforeEachOriginal;
  });

  it("falls back to false rather than throwing", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
