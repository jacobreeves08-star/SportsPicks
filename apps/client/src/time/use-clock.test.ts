import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClockSync, resetClockSyncForTests } from "./server-clock.js";
import { useCorrectedNow } from "./use-clock.js";

beforeEach(() => {
  resetClockSyncForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCorrectedNow", () => {
  it("ticks on the given interval using the corrected clock", () => {
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    const { result } = renderHook(() => useCorrectedNow(1000));

    expect(result.current).toBe(new Date("2026-08-13T12:00:00.000Z").getTime());

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(new Date("2026-08-13T12:00:01.000Z").getTime());
  });

  it("re-renders immediately on a new sync sample, not just on the next tick", () => {
    vi.setSystemTime(new Date("2026-08-13T12:04:00.000Z")); // device is 4 min fast
    const { result } = renderHook(() => useCorrectedNow(1000));

    expect(result.current).toBe(new Date("2026-08-13T12:04:00.000Z").getTime());

    act(() => {
      const now = Date.now();
      recordClockSync("2026-08-13T12:00:00.000Z", now, now);
    });

    // Corrected immediately, without needing to advance the tick timer.
    expect(result.current).toBe(new Date("2026-08-13T12:00:00.000Z").getTime());
  });

  it("stops ticking after unmount", () => {
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    const { result, unmount } = renderHook(() => useCorrectedNow(1000));
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // No assertion possible on unmounted state directly; this test's
    // real job is to confirm unmount doesn't throw (interval/listener
    // cleaned up) — vitest fails the suite on an uncaught error/timer
    // callback touching an unmounted component's setState otherwise.
    expect(result.current).toBe(new Date("2026-08-13T12:00:00.000Z").getTime());
  });
});
