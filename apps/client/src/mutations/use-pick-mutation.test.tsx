import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.js";
import type { SlateResponse, WrittenPick } from "../api/types.js";
import { queryKeys } from "../query/keys.js";
import { usePickMutation } from "./use-pick-mutation.js";

vi.mock("../api/endpoints.js", () => ({ writePick: vi.fn() }));

function slate(overrides: Partial<SlateResponse> = {}): SlateResponse {
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
    ...overrides,
  };
}

function setup(initialSlate: SlateResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.slate("league-1", "2026-08-13"), initialSlate);

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const rendered = renderHook(() => usePickMutation("league-1", "member-1"), { wrapper });
  return { client, ...rendered };
}

describe("usePickMutation — optimistic fill", () => {
  it("fills myPick and bumps pickedCount SYNCHRONOUSLY, before the write resolves", async () => {
    const { writePick } = await import("../api/endpoints.js");
    let resolveWrite!: (value: WrittenPick) => void;
    vi.mocked(writePick).mockReturnValue(new Promise<WrittenPick>((resolve) => (resolveWrite = resolve)));

    const { client, result } = setup(slate());

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13" });
    });

    // Still pending — the mock promise hasn't resolved — but the cache
    // already reflects the pick.
    const optimistic = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(optimistic?.games[0]?.myPick).toBe("Bills");
    expect(optimistic?.games[0]?.pickState).toBe("picked_open");
    expect(optimistic?.pickedCount).toBe(1);

    resolveWrite({ id: "pick-1", leagueMemberId: "member-1", gameId: "game-1", selectedTeam: "Bills", createdAt: "2026-08-13T12:00:00.000Z" });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("does not double-count pickedCount when changing an EXISTING pick", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockReturnValue(new Promise(() => {})); // never resolves for this test

    const alreadyPicked = slate({
      games: [{ ...slate().games[0]!, myPick: "Bills", pickState: "picked_open" }],
      pickedCount: 1,
    });
    const { client, result } = setup(alreadyPicked);

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Jets", date: "2026-08-13" });
    });

    const optimistic = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(optimistic?.games[0]?.myPick).toBe("Jets");
    expect(optimistic?.pickedCount).toBe(1); // unchanged — it was already counted
  });
});

describe("usePickMutation — server confirm", () => {
  it("reconciles with the server's response and leaves no rejection on success", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockResolvedValue({
      id: "pick-1",
      leagueMemberId: "member-1",
      gameId: "game-1",
      selectedTeam: "Bills",
      createdAt: "2026-08-13T12:00:00.000Z",
    });

    const { client, result } = setup(slate());

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13" });
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.rejection).toBeNull();
    const final = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(final?.games[0]?.myPick).toBe("Bills");
  });
});

describe("usePickMutation — visible, explained revert on rejection", () => {
  it("reverts the cache to the exact prior snapshot and records a rejection that does not self-clear", async () => {
    const { writePick } = await import("../api/endpoints.js");
    const rejectionError = new ApiError({ code: "PICK_LOCKED", message: "Picking has closed for this game" }, 409);
    vi.mocked(writePick).mockRejectedValue(rejectionError);

    const { client, result } = setup(slate());

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13" });
    });

    await waitFor(() => expect(result.current.rejection).not.toBeNull());

    expect(result.current.rejection).toMatchObject({
      gameId: "game-1",
      attemptedSelectedTeam: "Bills",
      revertedTo: null, // there was no prior pick
      reason: rejectionError,
    });

    const reverted = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(reverted?.games[0]?.myPick).toBeNull();
    expect(reverted?.pickedCount).toBe(0);

    // Never self-clears — still present with no further action.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.rejection).not.toBeNull();
  });

  it("reverts to the PRIOR pick (not blank) when changing an existing pick fails", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409));

    const alreadyPicked = slate({
      games: [{ ...slate().games[0]!, myPick: "Bills", pickState: "picked_open" }],
      pickedCount: 1,
    });
    const { client, result } = setup(alreadyPicked);

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Jets", date: "2026-08-13" });
    });

    await waitFor(() => expect(result.current.rejection).not.toBeNull());
    expect(result.current.rejection?.revertedTo).toBe("Bills");

    const reverted = client.getQueryData<SlateResponse>(queryKeys.slate("league-1", "2026-08-13"));
    expect(reverted?.games[0]?.myPick).toBe("Bills");
  });

  it("dismissRejection is the only thing that clears an acknowledged rejection", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409));

    const { result } = setup(slate());

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13" });
    });
    await waitFor(() => expect(result.current.rejection).not.toBeNull());

    act(() => result.current.dismissRejection());
    expect(result.current.rejection).toBeNull();
  });

  it("a fresh attempt on the SAME game clears a stale rejection", async () => {
    const { writePick } = await import("../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValueOnce(new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409));

    const { result } = setup(slate());

    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Bills", date: "2026-08-13" });
    });
    await waitFor(() => expect(result.current.rejection).not.toBeNull());

    vi.mocked(writePick).mockReturnValue(new Promise(() => {})); // second attempt never resolves
    act(() => {
      result.current.writePick({ gameId: "game-1", selectedTeam: "Jets", date: "2026-08-13" });
    });

    expect(result.current.rejection).toBeNull();
  });
});
