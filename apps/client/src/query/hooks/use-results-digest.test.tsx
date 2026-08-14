import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ResultsDigestResponse } from "../../api/types.js";
import { useResultsDigest } from "./use-results-digest.js";

vi.mock("../../api/endpoints.js", () => ({ getResultsDigest: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useResultsDigest", () => {
  it("loads the digest through the query hook", async () => {
    const { getResultsDigest } = await import("../../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 2, losses: 1, gamesParticipated: 3, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    const { result } = renderHook(() => useResultsDigest(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
  });

  it("does not fetch at all when enabled is false", () => {
    const { result } = renderHook(() => useResultsDigest(false), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
