import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/errors.js";
import { enqueuePickWrite, flushQueue, resetQueueForTests } from "./queue.js";
import { useUnsavedPickCount } from "./use-unsaved-pick-count.js";

beforeEach(() => {
  resetQueueForTests();
});

afterEach(() => {
  resetQueueForTests();
});

describe("useUnsavedPickCount", () => {
  it("is zero with an empty queue", () => {
    const { result } = renderHook(() => useUnsavedPickCount());
    expect(result.current).toBe(0);
  });

  it("counts queued entries across DIFFERENT leagues — unlike useOfflineQueue, this is global", () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    enqueuePickWrite({ leagueId: "league-2", memberId: "member-2", gameId: "game-2", selectedTeam: "Chiefs", previousSelectedTeam: null });

    const { result } = renderHook(() => useUnsavedPickCount());
    expect(result.current).toBe(2);
  });

  it("updates live as entries are enqueued", async () => {
    const { result } = renderHook(() => useUnsavedPickCount());
    expect(result.current).toBe(0);

    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });

    await waitFor(() => expect(result.current).toBe(1));
  });

  it("excludes failed entries — they're a distinct, already-surfaced signal, not 'still pending'", async () => {
    enqueuePickWrite({
      leagueId: "league-1",
      memberId: "member-1",
      gameId: "game-1",
      selectedTeam: "Jets",
      previousSelectedTeam: "Bills",
    });
    enqueuePickWrite({
      leagueId: "league-2",
      memberId: "member-2",
      gameId: "game-2",
      selectedTeam: "Chiefs",
      previousSelectedTeam: null,
    });

    // Drive the first entry to a genuine "failed" status via the real
    // flushQueue path (a terminal, non-network rejection) — the
    // second stays pending untouched.
    await flushQueue({
      write: async (entry) => {
        if (entry.gameId === "game-1") {
          throw new ApiError({ code: "PICK_LOCKED", message: "This game already locked." }, 409);
        }
        return {
          id: "written-1",
          leagueMemberId: entry.memberId,
          gameId: entry.gameId,
          selectedTeam: entry.selectedTeam,
          createdAt: new Date().toISOString(),
        };
      },
    });

    const { result } = renderHook(() => useUnsavedPickCount());
    // game-1 is "failed" (excluded), game-2 succeeded and left the
    // queue entirely — so the count is 0, not 1.
    expect(result.current).toBe(0);
  });
});
