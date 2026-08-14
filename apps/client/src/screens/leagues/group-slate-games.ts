import type { SlateGame } from "../../api/types.js";

export interface SlateGameGroup {
  sport: string;
  games: SlateGame[];
}

/**
 * "Grouped sensibly (by sport, or by lock time)" (Epic 11 brief) — a
 * single league can carry more than one sport, so both at once: one
 * section per sport, sections ordered by their own EARLIEST game
 * (the most time-urgent sport first), games within a section ordered
 * by `startsAt` ascending. Pure and independently tested, same
 * "derive first, render second" split as `derive-global-banner.ts`.
 */
export function groupSlateGamesBySport(games: SlateGame[]): SlateGameGroup[] {
  const bySport = new Map<string, SlateGame[]>();
  for (const game of games) {
    const existing = bySport.get(game.sport);
    if (existing) {
      existing.push(game);
    } else {
      bySport.set(game.sport, [game]);
    }
  }

  const groups: SlateGameGroup[] = Array.from(bySport.entries()).map(([sport, sportGames]) => ({
    sport,
    games: [...sportGames].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
  }));

  groups.sort((a, b) => Date.parse(a.games[0]!.startsAt) - Date.parse(b.games[0]!.startsAt));

  return groups;
}
