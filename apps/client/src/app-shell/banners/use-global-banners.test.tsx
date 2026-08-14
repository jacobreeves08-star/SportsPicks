import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsSummary } from "../../api/types.js";
import { enqueuePickWrite, resetQueueForTests } from "../../offline/queue.js";
import { useGlobalBanners } from "./use-global-banners.js";

vi.mock("../../api/endpoints.js", () => ({ getDataFreshness: vi.fn(), pingHealth: vi.fn() }));

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

const HEALTHY_SUMMARY: OpsSummary = {
  jobs: [{ jobName: "score-poll", lastRunAt: "2026-08-13T18:00:00.000Z", lastRunSucceeded: true, lastSuccessAt: "2026-08-13T18:00:00.000Z" }],
  staleGameCount: 0,
  correctionsLast24h: 0,
  signupsLast24h: 0,
  picksLast24h: 0,
  slateCompletionRates: [],
  generatedAt: "2026-08-13T18:05:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const originalOnLine = navigator.onLine;

beforeEach(() => {
  vi.clearAllMocks();
  resetQueueForTests();
  setNavigatorOnline(true);
});

afterEach(() => {
  setNavigatorOnline(originalOnLine);
  resetQueueForTests();
  vi.restoreAllMocks();
});

describe("useGlobalBanners", () => {
  it("returns null when everything is healthy", async () => {
    const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });

    const { result } = renderHook(() => useGlobalBanners(), { wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("shows offline immediately, without waiting for the freshness poll", async () => {
    const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
    setNavigatorOnline(false);

    const { result } = renderHook(() => useGlobalBanners(), { wrapper });
    expect(result.current).toEqual({ kind: "offline" });
  });

  it("shows unsaved-picks with the correct global count", async () => {
    const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });

    const { result } = renderHook(() => useGlobalBanners(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ kind: "unsaved-picks", count: 1 }));
  });

  it("shows stale once the freshness poll resolves with a stale count", async () => {
    const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue({ ...HEALTHY_SUMMARY, staleGameCount: 2 });
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });

    const { result } = renderHook(() => useGlobalBanners(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ kind: "stale", asOf: HEALTHY_SUMMARY.generatedAt }));
  });

  it("shows degraded when the health ping itself fails", async () => {
    const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useGlobalBanners(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ kind: "degraded" }));
  });

  it("shows reconnecting for a window after coming back online", async () => {
    vi.useFakeTimers();
    try {
      const { getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
      vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
      vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
      setNavigatorOnline(false);

      const { result, rerender } = renderHook(() => useGlobalBanners(), { wrapper });
      expect(result.current).toEqual({ kind: "offline" });

      act(() => {
        setNavigatorOnline(true);
        window.dispatchEvent(new Event("online"));
      });
      rerender();
      expect(result.current).toEqual({ kind: "reconnecting" });

      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      rerender();
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
