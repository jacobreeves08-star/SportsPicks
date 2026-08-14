export interface SportOption {
  value: string;
  label: string;
}

/**
 * Mirrors `apps/api/src/lib/sports-provider.ts`'s `ESPN_SPORT_SLUGS`
 * keys — the server's own canonical, validated list (`POST /leagues`
 * rejects anything else with `VALIDATION_ERROR`). No catalog endpoint
 * exists to fetch this from, so this is a deliberate, minimal
 * client-side mirror, not a shared import — the client and server are
 * separate deployables and can't share a module across that boundary.
 */
export const SPORT_OPTIONS: SportOption[] = [
  { value: "nfl", label: "NFL" },
  { value: "ncaaf", label: "NCAA Football" },
  { value: "nba", label: "NBA" },
  { value: "ncaamb", label: "NCAA Men's Basketball" },
  { value: "mlb", label: "MLB" },
  { value: "nhl", label: "NHL" },
  { value: "epl", label: "Premier League" },
  { value: "ucl", label: "Champions League" },
  { value: "mls", label: "MLS" },
];

/** Falls back to the raw code for anything not in the list above
 * (defensive — the server is the source of truth on valid codes, this
 * is purely a display label lookup). */
export function sportLabel(code: string): string {
  return SPORT_OPTIONS.find((option) => option.value === code)?.label ?? code;
}
