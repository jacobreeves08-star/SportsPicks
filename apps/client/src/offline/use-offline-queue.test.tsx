import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, networkError } from "../api/errors.js";
import type { SlateResponse } from "../api/types.js";
import { queryKeys } from "../query/keys.js";
import { resetQueueForTests } from "./queue.js";
import { useOfflineQueue } from "./use-offline-queue.js";

vi.mock("../api/endpoints.js", () => ({ writePick: vi.fn() }));

function slate(): SlateResponse {
  return {
    date: "2026-08-13",
    games: [
      {
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
        startsAt: "2026-08-13T20:00:00.000Z",
        status: "scheduled",
        allowsDraw: false,
        winningTeam: null,
        locked: false,
        myPick: null,
        otherPicks: [],
        pickState: "unpicked",
      },
    ],
    pickedCount: 0,
    totalCount: 1,
  };
}

function setup() {
  resetQueueForTests();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.slate("league-1", "2026-08-13"), slate());

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return { client, wrapper };
}

beforeEach(() => {
  // Each test's assertions count exact `writePick` call totals — this
  // module-level mock's call history otherwise carries over BETWEEN
  // tests in this file (confirmed empirically: without this, a later
  // test's "called once" assertion saw the cumulative count from every
  // earlier test's own enqueue/flush calls, not just its own).
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOfflineQueue", () => {
  it("enqueue optimistically fills the slate cache and marks the game as queued/unsaved", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockReturnValue(new Promise(() => {})); // never resolves — stays queued
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useOfflineQueue("league-1", "member-1"), { wrapper });

    act(() => {
      result.current.enqueue({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13", previousSelectedTeam: null });
    });

    const cached = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(cached?.games[0]?.myPick).toBe("Bills");
    expect(result.current.isQueued("game-1")).toBe(true);
  });

  it("on a successful flush, removes the entry and reconciles the cache with the server's confirmed value", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockResolvedValue({
      id: "pick-1",
      leagueMemberId: "member-1",
      gameId: "game-1",
      selectedTeam: "Bills",
      createdAt: "2026-08-13T12:00:00.000Z",
    });
    const { client, wrapper } = setup();

    const { result } = renderHook(() => useOfflineQueue("league-1", "member-1"), { wrapper });

    act(() => {
      result.current.enqueue({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13", previousSelectedTeam: null });
    });

    await waitFor(() => expect(result.current.isQueued("game-1")).toBe(false));
    expect(result.current.queue).toHaveLength(0);
    const cached = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(cached?.games[0]?.myPick).toBe("Bills");
  });

  it("on a confirmed rejection, reverts the cache to the value from before it was queued and keeps the failed entry visible", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "Picking has closed for this game" }, 409));
    const { client, wrapper } = setup();
    // Seed a prior real pick so previousSelectedTeam has something
    // other than null to revert to.
    client.setQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"), (current) =>
      current ? { ...current, games: [{ ...current.games[0]!, myPick: "Jets", pickState: "picked_open" }] } : current,
    );

    const { result } = renderHook(() => useOfflineQueue("league-1", "member-1"), { wrapper });

    act(() => {
      result.current.enqueue({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13", previousSelectedTeam: "Jets" });
    });

    await waitFor(() => {
      const failed = result.current.queue.find((e) => e.gameId === "game-1");
      expect(failed?.status).toBe("failed");
    });

    const cached = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(cached?.games[0]?.myPick).toBe("Jets"); // reverted to the true prior value, not blank
    expect(result.current.isQueued("game-1")).toBe(false); // failed, not "still pending"

    act(() => result.current.dismissFailedEntry(result.current.queue[0]!.id));
    expect(result.current.queue).toHaveLength(0);
  });

  it("retries on the browser 'online' event", async () => {
    const { writePick } = await import("../api/endpoints.js");
    // A real offline fetch REJECTS (a network error) — it doesn't hang
    // forever unresolved. Using a genuinely never-settling promise
    // here would wedge the queue module's flush-in-progress lock
    // indefinitely (confirmed empirically), which isn't how offline
    // failures actually behave.
    vi.mocked(writePick).mockRejectedValueOnce(networkError(new TypeError("Failed to fetch")));
    const { wrapper } = setup();

    const { result } = renderHook(() => useOfflineQueue("league-1", "member-1"), { wrapper });
    act(() => {
      result.current.enqueue({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13", previousSelectedTeam: null });
    });
    await waitFor(() => expect(result.current.queue[0]?.status).toBe("pending")); // reverted to pending after the network failure, not "failed"
    expect(writePick).toHaveBeenCalledTimes(1); // the enqueue-time flush attempt

    vi.mocked(writePick).mockResolvedValue({
      id: "pick-1",
      leagueMemberId: "member-1",
      gameId: "game-1",
      selectedTeam: "Bills",
      createdAt: "2026-08-13T12:00:00.000Z",
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(result.current.queue).toHaveLength(0));
  });
});
