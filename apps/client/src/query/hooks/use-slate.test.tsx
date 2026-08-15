import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlateResponse } from "../../api/types.js";
import { resetClockSyncForTests } from "../../time/server-clock.js";
import { pollingContextFromSlate, useSlate } from "./use-slate.js";

vi.mock("../../api/endpoints.js", () => ({ getSlate: vi.fn() }));

const NOW = new Date("2026-08-13T18:00:00.000Z").getTime();

function slateGame(overrides: Partial<SlateResponse["games"][number]> = {}): SlateResponse["games"][number] {
  return {
    gameId: "game-1",
    sport: "nfl",
    homeTeam: "Bills",
    awayTeam: "Jets",
    homeTeamLogoUrl: null,
    awayTeamLogoUrl: null,
    homeTeamFlagUrl: null,
    awayTeamFlagUrl: null,
    homeTeamColor: null,
    awayTeamColor: null,
    startsAt: new Date(NOW + 60_000).toISOString(),
    status: "scheduled",
    allowsDraw: false,
    winningTeam: null,
    locked: false,
    myPick: null,
    otherPicks: [],
    pickState: "unpicked",
    ...overrides,
  };
}

beforeEach(() => {
  resetClockSyncForTests();
});

describe("pollingContextFromSlate", () => {
  // Fake timers scoped to just this describe block — the useSlate
  // hook tests below use React Testing Library's `waitFor`, which
  // polls on REAL timers internally; leaving fake timers active for
  // those causes waitFor to never observe a state change and time out
  // (confirmed empirically — the fix here is scoping, not disabling
  // this suite's need for a deterministic "now").
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null/false with no data", () => {
    expect(pollingContextFromSlate(undefined)).toEqual({ msUntilNearestLock: null, hasGamesInProgress: false });
  });

  it("computes msUntilNearestLock for a single SCHEDULED game", () => {
    const data: SlateResponse = {
      date: "2026-08-13",
      games: [slateGame({ startsAt: new Date(NOW + 5 * 60_000).toISOString() })],
      pickedCount: 0,
      totalCount: 1,
    };
    const context = pollingContextFromSlate(data);
    expect(context.msUntilNearestLock).toBe(5 * 60_000);
    expect(context.hasGamesInProgress).toBe(false);
  });

  it("picks the MINIMUM remaining time across multiple SCHEDULED games", () => {
    const data: SlateResponse = {
      date: "2026-08-13",
      games: [
        slateGame({ gameId: "far", startsAt: new Date(NOW + 60 * 60_000).toISOString() }),
        slateGame({ gameId: "near", startsAt: new Date(NOW + 2 * 60_000).toISOString() }),
      ],
      pickedCount: 0,
      totalCount: 2,
    };
    const context = pollingContextFromSlate(data);
    expect(context.msUntilNearestLock).toBe(2 * 60_000);
  });

  it("flags hasGamesInProgress for a LOCKED (in_progress, ungraded) game", () => {
    const data: SlateResponse = {
      date: "2026-08-13",
      games: [slateGame({ status: "in_progress", startsAt: new Date(NOW - 60_000).toISOString(), locked: true })],
      pickedCount: 0,
      totalCount: 1,
    };
    const context = pollingContextFromSlate(data);
    expect(context.hasGamesInProgress).toBe(true);
    expect(context.msUntilNearestLock).toBeNull();
  });

  it("ignores FINAL and VOID games entirely for polling purposes", () => {
    const data: SlateResponse = {
      date: "2026-08-13",
      games: [
        slateGame({ gameId: "final", status: "final", winningTeam: "Bills", startsAt: new Date(NOW - 3600_000).toISOString() }),
        slateGame({ gameId: "void", status: "canceled", startsAt: new Date(NOW - 3600_000).toISOString() }),
      ],
      pickedCount: 0,
      totalCount: 2,
    };
    const context = pollingContextFromSlate(data);
    expect(context).toEqual({ msUntilNearestLock: null, hasGamesInProgress: false });
  });
});

describe("useSlate", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("loads slate data through the query hook", async () => {
    const { getSlate } = await import("../../api/endpoints.js");
    const response: SlateResponse = { date: "2026-08-13", games: [slateGame()], pickedCount: 0, totalCount: 1 };
    vi.mocked(getSlate).mockResolvedValue(response);

    const { result } = renderHook(() => useSlate("league-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(getSlate).toHaveBeenCalledWith("league-1", undefined);
  });

  it("does not fetch at all when leagueId is empty (enabled: false)", () => {
    const { result } = renderHook(() => useSlate(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
