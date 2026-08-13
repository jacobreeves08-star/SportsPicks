import { useSlate } from "../query/hooks/use-slate.js";
import { deriveGameState } from "../game-state/game-state.js";
import { usePickMutation } from "../mutations/use-pick-mutation.js";
import { useCorrectedNow } from "../time/use-clock.js";

/**
 * TEST HARNESS — NOT A PRODUCT SCREEN. This directory exists solely so
 * e2e/lock-transition.spec.ts has something to assert against in a
 * real browser. Epics 9-11 build the actual pick-flow UI; nothing
 * here should be treated as a preview of it, and nothing in
 * src/main.tsx or routes/route-tree.tsx references this file — it's
 * reached only via harness.html (its own separate Vite entry, see
 * vite.config.ts), which the real app never links to.
 *
 * Renders the CLIENT-DERIVED GameState for one game, live, ticking on
 * the corrected clock, plus a way to attempt a pick write against it —
 * exactly the two things the e2e brief needs to observe: "the control
 * locks in the UI" (`data-testid="game-state"`) and "a late write is
 * rejected by the API with the expected error code"
 * (`data-testid="rejection-code"`). All identifiers come from the URL
 * query string so the e2e test controls exactly which real,
 * server-seeded league/member/game this points at.
 */
export function LockTransitionHarness() {
  const params = new URLSearchParams(window.location.search);
  const leagueId = params.get("leagueId") ?? "";
  const memberId = params.get("memberId") ?? "";
  const gameId = params.get("gameId") ?? "";
  const date = params.get("date") ?? undefined;

  const { data, isLoading, isError, error } = useSlate(leagueId, date);
  const now = useCorrectedNow(250); // fast tick — this is a harness, not a battery-conscious real screen
  const { writePick, rejection, isPending } = usePickMutation(leagueId, memberId);

  const game = data?.games.find((g) => g.gameId === gameId);
  const state = game ? deriveGameState(game, now) : null;

  return (
    <div>
      <p data-testid="game-state">{isLoading ? "LOADING" : (state?.kind ?? "NOT_FOUND")}</p>
      <p data-testid="query-error">{isError ? `${error.code}: ${error.message}` : ""}</p>
      <p data-testid="game-count">{data ? String(data.games.length) : ""}</p>
      <p data-testid="mutation-pending">{isPending ? "true" : "false"}</p>
      <button
        type="button"
        data-testid="write-pick"
        disabled={!game}
        onClick={() => {
          if (game) writePick({ gameId, selectedTeam: game.homeTeam, date });
        }}
      >
        Write pick
      </button>
      <p data-testid="rejection-code">{rejection?.reason.code ?? ""}</p>
    </div>
  );
}
