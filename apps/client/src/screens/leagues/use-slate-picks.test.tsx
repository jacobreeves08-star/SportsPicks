import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors.js";
import type { SlateGame, SlateResponse } from "../../api/types.js";
import type { GameState } from "../../game-state/game-state.js";
import { resetQueueForTests } from "../../offline/queue.js";
import { queryKeys } from "../../query/keys.js";
import { useSlatePicks } from "./use-slate-picks.js";

vi.mock("../../api/endpoints.js", () => ({ writePick: vi.fn() }));

const mockUseOnlineStatus = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../network/use-online-status.js", () => ({ useOnlineStatus: mockUseOnlineStatus }));

const SCHEDULED_STATE: GameState = { kind: "SCHEDULED", startsAt: new Date("2026-08-13T20:00:00.000Z") };

function game(overrides: Partial<SlateGame> = {}): SlateGame {
  return {
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
    ...overrides,
  };
}

function slate(overrides: Partial<SlateResponse> = {}): SlateResponse {
  return { date: "2026-08-13", games: [game()], pickedCount: 0, totalCount: 1, ...overrides };
}

function setup() {
  resetQueueForTests();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.slate("league-1", "2026-08-13"), slate());

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const nowMs = new Date("2026-08-13T12:00:00.000Z").getTime();
  const rendered = renderHook(() => useSlatePicks("league-1", "member-1", "2026-08-13", 7, nowMs), { wrapper });
  return { client, ...rendered };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseOnlineStatus.mockReturnValue(true);
});

describe("useSlatePicks — online path", () => {
  it("shows pending while a write is in flight, for this game only", async () => {
    const { writePick } = await import("../../api/endpoints.js");
    let resolveWrite!: (value: { id: string; leagueMemberId: string; gameId: string; selectedTeam: string; createdAt: string }) => void;
    vi.mocked(writePick).mockReturnValue(new Promise((resolve) => (resolveWrite = resolve)));

    const { result } = setup();

    act(() => result.current.selectPick(game(), "Bills"));

    expect(result.current.getState(game({ myPick: "Bills" }), SCHEDULED_STATE)).toEqual({
      status: "pending",
      optimistic: "Bills",
      previous: null,
    });

    resolveWrite({ id: "pick-1", leagueMemberId: "member-1", gameId: "game-1", selectedTeam: "Bills", createdAt: "2026-08-13T12:00:00.000Z" });
    await waitFor(() =>
      expect(result.current.getState(game({ myPick: "Bills" }), SCHEDULED_STATE)).toEqual({ status: "open", selected: "Bills" }),
    );
  });

  it("shows rejected, with the calm message, on a genuine server rejection", async () => {
    const { writePick } = await import("../../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "raw" }, 409));

    const { result } = setup();
    act(() => result.current.selectPick(game(), "Bills"));

    await waitFor(() =>
      expect(result.current.getState(game(), SCHEDULED_STATE)).toEqual({
        status: "rejected",
        attempted: "Bills",
        revertedTo: null,
        message: "This game locked before your pick saved.",
      }),
    );
  });

  it("falls back to queued (not rejected) when the online write fails with a network error", async () => {
    const { writePick } = await import("../../api/endpoints.js");
    const { networkError } = await import("../../api/errors.js");
    vi.mocked(writePick).mockRejectedValue(networkError(new Error("fetch failed")));

    const { result } = setup();
    act(() => result.current.selectPick(game(), "Bills"));

    await waitFor(() => expect(result.current.getState(game({ myPick: "Bills" }), SCHEDULED_STATE).status).toBe("queued"));
    expect(result.current.getState(game({ myPick: "Bills" }), SCHEDULED_STATE)).toEqual({
      status: "queued",
      queued: "Bills",
      previous: null,
    });
  });
});

describe("useSlatePicks — offline path", () => {
  it("goes straight through the offline queue (never usePickMutation) when offline", async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { writePick } = await import("../../api/endpoints.js");
    // Genuinely offline — the queue's own defensive flush attempt
    // (useOfflineQueue's "in case connectivity was actually fine")
    // never resolves, same as a real hung fetch on a dead connection.
    vi.mocked(writePick).mockReturnValue(new Promise(() => {}));

    const { result } = setup();
    act(() => result.current.selectPick(game(), "Bills"));

    expect(result.current.getState(game({ myPick: "Bills" }), SCHEDULED_STATE)).toEqual({
      status: "queued",
      queued: "Bills",
      previous: null,
    });
  });
});

describe("useSlatePicks — offline queue's own confirmed rejection", () => {
  it("maps a failed queue entry (server rejected it once actually sent) to rejected", async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { writePick } = await import("../../api/endpoints.js");
    vi.mocked(writePick).mockRejectedValue(new ApiError({ code: "GAME_CANCELED", message: "raw" }, 409));

    const { result } = setup();
    act(() => result.current.selectPick(game(), "Bills"));

    // Back online triggers the queue's own flush, independent of this hook.
    mockUseOnlineStatus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(result.current.getState(game(), SCHEDULED_STATE)).toEqual({
        status: "rejected",
        attempted: "Bills",
        revertedTo: null,
        message: "This game was canceled.",
      }),
    );
  });
});
