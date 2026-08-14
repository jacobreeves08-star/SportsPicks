import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeagueHomeEntry } from "../api/types.js";
import { resetCurrentLeagueForTests, setCurrentLeagueId } from "./current-league-store.js";
import { useCurrentLeagueId } from "./use-current-league.js";

vi.mock("../api/endpoints.js", () => ({ getMyLeagues: vi.fn() }));

function league(overrides: Partial<LeagueHomeEntry> = {}): LeagueHomeEntry {
  return {
    id: "league-1",
    leagueMemberId: "member-1",
    name: "Test League",
    sports: ["nfl"],
    memberCount: 4,
    record: { wins: 0, losses: 0 },
    gamesParticipated: 0,
    rank: 1,
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetCurrentLeagueForTests();
  localStorage.clear();
});

afterEach(() => {
  resetCurrentLeagueForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useCurrentLeagueId", () => {
  it("returns undefined while leagues are still loading", () => {
    const { result } = renderHook(() => useCurrentLeagueId(), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it("returns undefined when the caller is in zero leagues", async () => {
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([]);

    const { result } = renderHook(() => useCurrentLeagueId(), { wrapper });
    await waitFor(() => expect(result.current).toBeUndefined());
  });

  it("defaults to the first league when nothing is stored yet", async () => {
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1" }), league({ id: "league-2" })]);

    const { result } = renderHook(() => useCurrentLeagueId(), { wrapper });
    await waitFor(() => expect(result.current).toBe("league-1"));
  });

  it("uses the stored selection when it's still a real membership", async () => {
    setCurrentLeagueId("league-2");
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1" }), league({ id: "league-2" })]);

    const { result } = renderHook(() => useCurrentLeagueId(), { wrapper });
    await waitFor(() => expect(result.current).toBe("league-2"));
  });

  it("falls back to the first league when the stored selection is no longer a real membership (left/removed since)", async () => {
    setCurrentLeagueId("league-stale");
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1" }), league({ id: "league-2" })]);

    const { result } = renderHook(() => useCurrentLeagueId(), { wrapper });
    await waitFor(() => expect(result.current).toBe("league-1"));
  });
});
