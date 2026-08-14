import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/errors.js";
import type { SlateGame } from "../../api/types.js";
import type { GameState } from "../../game-state/game-state.js";
import { derivePickControlState, presentPickRejection } from "./derive-pick-control-state.js";

function game(overrides: Partial<SlateGame> = {}): SlateGame {
  return {
    gameId: "game-1",
    sport: "nfl",
    homeTeam: "Bills",
    awayTeam: "Jets",
    homeTeamLogoUrl: null,
    awayTeamLogoUrl: null,
    homeTeamColor: null,
    awayTeamColor: null,
    startsAt: "2026-08-13T18:00:00.000Z",
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

const NOW_MS = new Date("2026-08-13T12:00:00.000Z").getTime();

const baseInput = {
  isPending: false,
  isQueued: false,
  rejection: null,
  pendingPrevious: null,
  pickHorizonDays: 7,
  nowMs: NOW_MS,
};

describe("derivePickControlState", () => {
  it("maps SCHEDULED to open, carrying the current pick", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills" }),
      gameState: { kind: "SCHEDULED", startsAt: new Date(NOW_MS) } satisfies GameState,
    });
    expect(state).toEqual({ status: "open", selected: "Bills" });
  });

  it("maps LOCKED to locked", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Jets" }),
      gameState: { kind: "LOCKED", startsAt: new Date(NOW_MS) } satisfies GameState,
    });
    expect(state).toEqual({ status: "locked", selected: "Jets" });
  });

  it("maps FINAL with final_hit to a hit outcome, using the server's own answer", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills", pickState: "final_hit", status: "final", winningTeam: "Bills" }),
      gameState: { kind: "FINAL", startsAt: new Date(NOW_MS), winningTeam: "Bills" } satisfies GameState,
    });
    expect(state).toEqual({ status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" });
  });

  it("maps FINAL with final_miss to a miss outcome, including a never-picked game", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: null, pickState: "final_miss", status: "final", winningTeam: "Bills" }),
      gameState: { kind: "FINAL", startsAt: new Date(NOW_MS), winningTeam: "Bills" } satisfies GameState,
    });
    expect(state).toEqual({ status: "final", selected: null, winningTeam: "Bills", outcome: "miss" });
  });

  it("maps VOID with its reason", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills" }),
      gameState: { kind: "VOID", startsAt: new Date(NOW_MS), reason: "postponed" } satisfies GameState,
    });
    expect(state).toEqual({ status: "void", reason: "postponed", selected: "Bills" });
  });

  it("maps a SCHEDULED game beyond the pick horizon to not-yet-open, with opensAt = startsAt minus the horizon", () => {
    const startsAt = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000); // 10 days out, horizon is 7
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: null }),
      gameState: { kind: "SCHEDULED", startsAt } satisfies GameState,
    });
    expect(state).toEqual({
      status: "not-yet-open",
      selected: null,
      opensAt: new Date(startsAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("treats a game exactly at the horizon boundary as open, not not-yet-open", () => {
    const startsAt = new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000 - 1); // 1ms inside the horizon
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: null }),
      gameState: { kind: "SCHEDULED", startsAt } satisfies GameState,
    });
    expect(state).toEqual({ status: "open", selected: null });
  });

  it("re-evaluates the horizon against the current pickHorizonDays, not a cached one", () => {
    const startsAt = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000); // 10 days out
    const state = derivePickControlState({
      ...baseInput,
      pickHorizonDays: 14, // wider horizon now covers this game
      game: game({ myPick: null }),
      gameState: { kind: "SCHEDULED", startsAt } satisfies GameState,
    });
    expect(state).toEqual({ status: "open", selected: null });
  });

  it("maps an in-flight write to pending, regardless of the underlying GameState", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills" }),
      gameState: { kind: "SCHEDULED", startsAt: new Date(NOW_MS) } satisfies GameState,
      isPending: true,
      pendingPrevious: null,
    });
    expect(state).toEqual({ status: "pending", optimistic: "Bills", previous: null });
  });

  it("maps a queued offline write to queued, carrying the captured previous value", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Jets" }),
      gameState: { kind: "SCHEDULED", startsAt: new Date(NOW_MS) } satisfies GameState,
      isQueued: true,
      pendingPrevious: "Bills",
    });
    expect(state).toEqual({ status: "queued", queued: "Jets", previous: "Bills" });
  });

  it("maps a rejection to rejected, always showing the reverted value — never the attempted one", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills" }),
      gameState: { kind: "SCHEDULED", startsAt: new Date(NOW_MS) } satisfies GameState,
      rejection: {
        gameId: "game-1",
        attemptedSelectedTeam: "Jets",
        revertedTo: "Bills",
        reason: new ApiError({ code: "PICK_LOCKED", message: "Pick locked" }, 409),
      },
    });
    expect(state).toEqual({
      status: "rejected",
      attempted: "Jets",
      revertedTo: "Bills",
      message: "This game locked before your pick saved.",
    });
  });

  it("gives rejection precedence over pending/queued if all were somehow set at once", () => {
    const state = derivePickControlState({
      ...baseInput,
      game: game({ myPick: "Bills" }),
      gameState: { kind: "SCHEDULED", startsAt: new Date(NOW_MS) } satisfies GameState,
      isPending: true,
      isQueued: true,
      pendingPrevious: null,
      rejection: {
        gameId: "game-1",
        attemptedSelectedTeam: "Jets",
        revertedTo: "Bills",
        reason: new ApiError({ code: "GAME_CANCELED", message: "Canceled" }, 409),
      },
    });
    expect(state.status).toBe("rejected");
  });
});

describe("presentPickRejection", () => {
  it.each([
    ["PICK_LOCKED", "This game locked before your pick saved."],
    ["GAME_CANCELED", "This game was canceled."],
    ["GAME_POSTPONED", "This game was postponed."],
    ["INVALID_TEAM_SELECTION", "That's not a valid pick for this game."],
  ])("maps %s to a calm, specific message", (code, expected) => {
    expect(presentPickRejection(new ApiError({ code, message: "raw" }, 409))).toBe(expected);
  });

  it("falls back to a network-specific message for a network failure", () => {
    const error = new ApiError({ code: "NETWORK_ERROR", message: "fetch failed" }, 0);
    expect(presentPickRejection(error)).toBe("Couldn't reach the server.");
  });

  it("falls back to the server's own message for any other code", () => {
    const error = new ApiError({ code: "VALIDATION_ERROR", message: "Request failed validation" }, 400);
    expect(presentPickRejection(error)).toBe("Request failed validation");
  });
});
