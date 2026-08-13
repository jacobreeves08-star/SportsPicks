import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, networkError } from "../api/errors.js";
import type { WrittenPick } from "../api/types.js";
import {
  dismissFailedEntry,
  enqueuePickWrite,
  flushQueue,
  getQueue,
  resetQueueForTests,
  subscribeToQueue,
} from "./queue.js";

function writtenPick(gameId: string, selectedTeam: string): WrittenPick {
  return { id: `pick-${gameId}`, leagueMemberId: "member-1", gameId, selectedTeam, createdAt: "2026-08-13T12:00:00.000Z" };
}

beforeEach(() => {
  resetQueueForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enqueuePickWrite", () => {
  it("adds a pending entry", () => {
    const entry = enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    expect(entry.status).toBe("pending");
    expect(getQueue()).toHaveLength(1);
    expect(getQueue()[0]).toMatchObject({ gameId: "game-1", selectedTeam: "Bills" });
  });

  it("coalesces a second write for the same (league, member, game) into one entry", () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Jets", previousSelectedTeam: null });

    expect(getQueue()).toHaveLength(1);
    expect(getQueue()[0]?.selectedTeam).toBe("Jets");
  });

  it("does not coalesce writes for different games", () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-2", selectedTeam: "Chiefs", previousSelectedTeam: null });

    expect(getQueue()).toHaveLength(2);
  });

  it("a fresh enqueue for a previously-FAILED game replaces it with a clean pending entry", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    const write = vi.fn().mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409));
    await flushQueue({ write });
    expect(getQueue()[0]?.status).toBe("failed");

    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Jets", previousSelectedTeam: null });

    expect(getQueue()).toHaveLength(1);
    expect(getQueue()[0]).toMatchObject({ status: "pending", attempts: 0, selectedTeam: "Jets", lastError: null });
  });
});

describe("flushQueue — success", () => {
  it("removes the entry and calls onEntrySucceeded once the server confirms", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    const write = vi.fn().mockResolvedValue(writtenPick("game-1", "Bills"));
    const onEntrySucceeded = vi.fn();

    await flushQueue({ write, onEntrySucceeded });

    expect(getQueue()).toHaveLength(0);
    expect(onEntrySucceeded).toHaveBeenCalledTimes(1);
  });
});

describe("flushQueue — terminal rejection (never silently implies safety)", () => {
  it("marks the entry failed, records the real reason, and keeps it in the queue until dismissed", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    const rejection = new ApiError({ code: "PICK_LOCKED", message: "Picking has closed for this game" }, 409);
    const write = vi.fn().mockRejectedValue(rejection);
    const onEntryFailed = vi.fn();

    await flushQueue({ write, onEntryFailed });

    expect(getQueue()).toHaveLength(1); // NOT silently dropped
    expect(getQueue()[0]).toMatchObject({ status: "failed", lastError: { code: "PICK_LOCKED", message: rejection.message } });
    expect(onEntryFailed).toHaveBeenCalledWith(expect.objectContaining({ gameId: "game-1" }), rejection);
  });

  it("a terminal rejection on one entry does not block the rest of the pass", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-2", selectedTeam: "Chiefs", previousSelectedTeam: null });

    const write = vi.fn(async (entry) => {
      if (entry.gameId === "game-1") throw new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409);
      return writtenPick(entry.gameId, entry.selectedTeam);
    });

    await flushQueue({ write });

    expect(getQueue()).toHaveLength(1); // game-1 failed and stayed; game-2 succeeded and was removed
    expect(getQueue()[0]?.gameId).toBe("game-1");
    expect(getQueue()[0]?.status).toBe("failed");
  });

  it("dismissFailedEntry is the only thing that removes a failed entry", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    await flushQueue({ write: vi.fn().mockRejectedValue(new ApiError({ code: "PICK_LOCKED", message: "Locked" }, 409)) });

    const id = getQueue()[0]!.id;
    dismissFailedEntry(id);

    expect(getQueue()).toHaveLength(0);
  });
});

describe("flushQueue — network failure (retry with backoff, never a terminal failure)", () => {
  it("keeps the entry pending, bumps attempts, and stops the pass rather than treating a network blip as a rejection", async () => {
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-2", selectedTeam: "Chiefs", previousSelectedTeam: null });

    const write = vi.fn().mockRejectedValue(networkError(new TypeError("Failed to fetch")));

    await flushQueue({ write });

    // Both writes attempted? No — the pass stops after the FIRST
    // network failure, since every remaining entry would fail
    // identically right now.
    expect(write).toHaveBeenCalledTimes(1);
    expect(getQueue()).toHaveLength(2);
    const first = getQueue().find((e) => e.gameId === "game-1")!;
    expect(first.status).toBe("pending");
    expect(first.attempts).toBe(1);
    expect(first.lastError).toBeNull(); // never recorded as a rejection reason — it wasn't one
  });

  it("automatically retries with backoff and succeeds once connectivity returns", async () => {
    vi.useFakeTimers();
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });

    const write = vi
      .fn()
      .mockRejectedValueOnce(networkError(new TypeError("Failed to fetch")))
      .mockResolvedValueOnce(writtenPick("game-1", "Bills"));

    await flushQueue({ write });
    expect(getQueue()[0]?.status).toBe("pending");
    expect(write).toHaveBeenCalledTimes(1);

    // First backoff delay is 1000ms (1000 * 2^0).
    await vi.advanceTimersByTimeAsync(1000);

    expect(write).toHaveBeenCalledTimes(2);
    expect(getQueue()).toHaveLength(0);
  });
});

describe("subscribeToQueue", () => {
  it("notifies on every change and stops after unsubscribing", () => {
    const received: number[] = [];
    const unsubscribe = subscribeToQueue((queue) => received.push(queue.length));

    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-1", selectedTeam: "Bills", previousSelectedTeam: null });
    expect(received).toEqual([1]);

    unsubscribe();
    enqueuePickWrite({ leagueId: "league-1", memberId: "member-1", gameId: "game-2", selectedTeam: "Chiefs", previousSelectedTeam: null });
    expect(received).toEqual([1]); // no further notification
  });
});
