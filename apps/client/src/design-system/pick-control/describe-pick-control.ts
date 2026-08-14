import type { PickControlState, PickControlTeams } from "./PickControl.types.js";

/**
 * Implements `docs/accessibility-and-responsive.md`'s screen-reader
 * announcement table verbatim for the five real `pickState` values
 * (unpicked -> `open`/selected=null, picked_open -> `open`/selected,
 * locked -> `locked`, final_hit/final_miss -> `final`), PLUS the three
 * states that table doesn't cover (`void`, `pending`, `rejected`,
 * `queued`) using the same voice. This is the ONE place that text is
 * written — both `PickControl`'s `aria-label` on the radiogroup and
 * its internal live-region transition announcements read from this
 * function, so the two can never drift apart.
 */
export function describePickControl(state: PickControlState, teams: PickControlTeams): string {
  const matchup = `${teams.homeTeam} vs ${teams.awayTeam}`;

  switch (state.status) {
    case "open": {
      const lockTime = formatLockTime(teams.startsAt);
      return state.selected === null
        ? `${matchup}. No pick yet. Locks ${lockTime}.`
        : `${matchup}. You picked ${describeSide(state.selected)}. Still open — locks ${lockTime}.`;
    }
    case "not-yet-open": {
      const opensDate = formatOpensDate(state.opensAt);
      return `${matchup}. Picks open ${opensDate}.`;
    }
    case "locked": {
      return state.selected === null
        ? `${matchup}. Locked. You did not make a pick.`
        : `${matchup}. Locked. You picked ${describeSide(state.selected)}.`;
    }
    case "final": {
      const outcomeWord = state.outcome === "hit" ? "correct" : "incorrect";
      return state.selected === null
        ? `${matchup}. Final: ${describeSide(state.winningTeam)} won. You did not make a pick.`
        : `${matchup}. Final: ${describeSide(state.winningTeam)} won. You picked ${describeSide(state.selected)} — ${outcomeWord}.`;
    }
    case "void": {
      const reasonWord = state.reason === "postponed" ? "Postponed" : "Canceled";
      return `${matchup}. ${reasonWord}. This game does not count.`;
    }
    case "pending": {
      return `${matchup}. Saving ${describeSide(state.optimistic)}.`;
    }
    case "rejected": {
      const revertText = state.revertedTo === null ? "no pick" : describeSide(state.revertedTo);
      return `${matchup}. ${describeSide(state.attempted)} wasn't saved: ${state.message}. Reverted to ${revertText}.`;
    }
    case "queued": {
      return `${matchup}. ${describeSide(state.queued)} selected — not saved yet. Will send when back online.`;
    }
  }
}

/** The one place the literal `'DRAW'` API sentinel becomes the
 * human-readable "Draw" (docs/sports-pipeline.md's suggested UI
 * copy). Every other team value is already a real display name and
 * passes through unchanged. */
export function describeSide(team: string): string {
  return team === "DRAW" ? "Draw" : team;
}

function formatLockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** Mirrors `NotYetOpenBadge`'s own private formatter exactly (not
 * imported from there — `indicators/` is a lower-level module that
 * `pick-control/` already depends on, so the reverse import would be
 * circular). Keep the two in sync if this format ever changes. */
function formatOpensDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
