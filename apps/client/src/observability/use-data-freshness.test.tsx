import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsSummary } from "../api/types.js";
import { useDataFreshness, useHealthPing } from "./use-data-freshness.js";

vi.mock("../api/endpoints.js", () => ({ getDataFreshness: vi.fn(), pingHealth: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SUMMARY: OpsSummary = {
  jobs: [{ jobName: "score-poll", lastRunAt: "2026-08-13T18:00:00.000Z", lastRunSucceeded: true, lastSuccessAt: "2026-08-13T18:00:00.000Z" }],
  staleGameCount: 0,
  correctionsLast24h: 0,
  signupsLast24h: 0,
  picksLast24h: 0,
  slateCompletionRates: [],
  generatedAt: "2026-08-13T18:05:00.000Z",
};

describe("useDataFreshness", () => {
  it("loads the ops summary through the query hook", async () => {
    const { getDataFreshness } = await import("../api/endpoints.js");
    vi.mocked(getDataFreshness).mockResolvedValue(SUMMARY);

    const { result } = renderHook(() => useDataFreshness(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SUMMARY);
  });

  it("does not retry on failure — a failed poll IS the degraded signal", async () => {
    const { getDataFreshness } = await import("../api/endpoints.js");
    vi.mocked(getDataFreshness).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useDataFreshness(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getDataFreshness).toHaveBeenCalledTimes(1);
  });
});

describe("useHealthPing", () => {
  it("loads through the query hook", async () => {
    const { pingHealth } = await import("../api/endpoints.js");
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });

    const { result } = renderHook(() => useHealthPing(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ status: "ok" });
  });

  it("does not retry on failure", async () => {
    const { pingHealth } = await import("../api/endpoints.js");
    vi.mocked(pingHealth).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useHealthPing(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(pingHealth).toHaveBeenCalledTimes(1);
  });
});
