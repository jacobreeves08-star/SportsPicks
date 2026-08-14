import { describe, expect, it } from "vitest";
import type { SlateGame } from "../../api/types.js";
import { groupSlateGamesBySport } from "./group-slate-games.js";

function game(overrides: Partial<SlateGame> = {}): SlateGame {
  return {
    gameId: "game-1",
    sport: "nfl",
    homeTeam: "Bills",
    awayTeam: "Jets",
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

describe("groupSlateGamesBySport", () => {
  it("groups games by sport", () => {
    const groups = groupSlateGamesBySport([
      game({ gameId: "a", sport: "nfl" }),
      game({ gameId: "b", sport: "nba" }),
      game({ gameId: "c", sport: "nfl" }),
    ]);

    const sports = groups.map((g) => g.sport).sort();
    expect(sports).toEqual(["nba", "nfl"]);
    expect(groups.find((g) => g.sport === "nfl")?.games).toHaveLength(2);
  });

  it("orders games within a sport by startsAt ascending", () => {
    const groups = groupSlateGamesBySport([
      game({ gameId: "later", sport: "nfl", startsAt: "2026-08-13T22:00:00.000Z" }),
      game({ gameId: "earlier", sport: "nfl", startsAt: "2026-08-13T17:00:00.000Z" }),
    ]);

    expect(groups[0]!.games.map((g) => g.gameId)).toEqual(["earlier", "later"]);
  });

  it("orders sport groups by each group's own earliest game", () => {
    const groups = groupSlateGamesBySport([
      game({ gameId: "nba-early", sport: "nba", startsAt: "2026-08-13T15:00:00.000Z" }),
      game({ gameId: "nfl-late", sport: "nfl", startsAt: "2026-08-13T20:00:00.000Z" }),
    ]);

    expect(groups.map((g) => g.sport)).toEqual(["nba", "nfl"]);
  });

  it("returns an empty array for an empty slate", () => {
    expect(groupSlateGamesBySport([])).toEqual([]);
  });
});
