import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../feedback/Spinner.js";
import { CheckIcon, CloudOffIcon } from "../icons/index.js";
import { LockBadge, NotYetOpenBadge, ResultBadge, VoidBadge } from "../indicators/index.js";
import { Countdown } from "../primitives/Countdown.js";
import { Text } from "../primitives/Text.js";
import { cx } from "../utils/cx.js";
import visuallyHiddenStyles from "../utils/visually-hidden.module.css";
import { describePickControl, describeSide } from "./describe-pick-control.js";
import styles from "./PickControl.module.css";
import { teamSelectionStyle } from "./team-selection-style.js";
import type { PickControlState, PickControlTeams } from "./PickControl.types.js";

export interface PickControlProps {
  teams: PickControlTeams;
  state: PickControlState;
  /** Omit (or leave undefined) for non-interactive states — the
   * component itself decides whether a tap/click/arrow-select can
   * fire this, but a container is free to pass it always. */
  onSelect?: (team: string) => void;
  /** Only rendered while `state.status === "open"`. Pure prop, same
   * discipline as `Countdown` itself — a container computes this from
   * `correctedNow()`, never `Date.now()`. */
  remainingMs?: number;
  className?: string;
}

function sidesFor(teams: PickControlTeams): string[] {
  return teams.allowsDraw ? [teams.homeTeam, teams.awayTeam, "DRAW"] : [teams.homeTeam, teams.awayTeam];
}

function selectedTeamFor(state: PickControlState): string | null {
  switch (state.status) {
    case "open":
    case "not-yet-open":
    case "locked":
    case "final":
    case "void":
      return state.selected;
    case "pending":
      return state.optimistic;
    // The revert is ALWAYS what's shown as selected — never
    // `attempted`. A screen must never look like a rejected write
    // quietly succeeded (Epic 8's "visible, explained revert").
    case "rejected":
      return state.revertedTo;
    case "queued":
      return state.queued;
  }
}

function isInteractive(status: PickControlState["status"]): boolean {
  return status === "open" || status === "pending" || status === "rejected" || status === "queued";
}

/**
 * The signature component (Epic 9 brief). Semantically a RADIO GROUP
 * (`role="radiogroup"` + `role="radio"` sides with roving `tabIndex`
 * and arrow-key selection, per WAI-ARIA authoring practice) — never
 * two independent buttons. Disabled sides (locked/final/void) use
 * `aria-disabled`, never the native `disabled` attribute, because the
 * a11y doc requires them to stay focusable and readable, not removed
 * from tab order.
 */
export function PickControl({ teams, state, onSelect, remainingMs, className }: PickControlProps) {
  const sides = sidesFor(teams);
  const selected = selectedTeamFor(state);
  const interactive = isInteractive(state.status);
  const groupLabel = describePickControl(state, teams);

  const [focusedTeam, setFocusedTeam] = useState<string>(selected ?? sides[0]!);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Live-region diffing: announce a transition only when the state's
  // MEANING actually changed (comparing the fully-composed label,
  // not raw status), not on every re-render. Covers both "pick
  // accepted/rejected" and "a silent poll-driven lock while the user
  // is looking at it" (a11y doc) — entirely within this pure
  // component via React's own render diffing, no external
  // data-fetching hook required. Deliberately skips the very first
  // render (nothing to announce on initial mount).
  const previousLabelRef = useRef(groupLabel);
  const [liveMessage, setLiveMessage] = useState("");
  useEffect(() => {
    if (previousLabelRef.current !== groupLabel) {
      setLiveMessage(groupLabel);
      previousLabelRef.current = groupLabel;
    }
  }, [groupLabel]);

  // Keep the roving tab stop pointed at the current selection when it
  // changes from an EXTERNAL source (a poll landing, a server
  // confirm) rather than from the user arrowing through the control.
  useEffect(() => {
    setFocusedTeam((current) => (sides.includes(current) ? current : (selected ?? sides[0]!)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only on the values that define "external", not on focusedTeam itself
  }, [selected, teams.homeTeam, teams.awayTeam, teams.allowsDraw]);

  function moveFocusAndSelect(team: string) {
    setFocusedTeam(team);
    buttonRefs.current[team]?.focus();
    if (interactive) onSelect?.(team);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = sides.indexOf(focusedTeam);
    if (currentIndex === -1) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % sides.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + sides.length) % sides.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = sides.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    moveFocusAndSelect(sides[nextIndex]!);
  }

  return (
    <div className={cx(styles.pickControl, className)}>
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus --
          The GROUP container is deliberately not itself a tab stop —
          this is a roving-tabindex composite widget (WAI-ARIA radio
          group pattern): each `role="radio"` child carries its own
          tabIndex (0 or -1), and Tab enters/exits the whole group in
          one stop via whichever child currently has tabIndex 0. The
          rule's heuristic doesn't recognize this pattern and flags
          the container itself as needing a tabIndex, which would add
          a SECOND, redundant tab stop. */}
      <div role="radiogroup" aria-label={groupLabel} onKeyDown={handleKeyDown} className={styles.sides}>
        {sides.map((team) => {
          const isSelected = team === selected;
          const isWinner = state.status === "final" && team === state.winningTeam;
          const logoUrl =
            team === teams.homeTeam ? teams.homeTeamLogoUrl : team === teams.awayTeam ? teams.awayTeamLogoUrl : null;
          const teamColor =
            team === teams.homeTeam ? teams.homeTeamColor : team === teams.awayTeam ? teams.awayTeamColor : null;
          // Team-colored fill only while the pick is still "live" (not
          // yet graded) — a final game's win/miss framing (green/muted,
          // via .sideWinner / .sideInert below) is a different, more
          // important signal at that point and takes over instead. Falls
          // back to the plain accent fill (via .sideSelected alone) when
          // there's no usable color — DRAW never has one, and neither
          // does a manually-entered game.
          const selectionStyle = isSelected && state.status !== "final" ? teamSelectionStyle(teamColor) : null;
          return (
            <button
              key={team}
              ref={(el) => {
                buttonRefs.current[team] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={!interactive}
              tabIndex={team === focusedTeam ? 0 : -1}
              onFocus={() => setFocusedTeam(team)}
              onClick={() => {
                if (interactive) onSelect?.(team);
              }}
              style={selectionStyle ?? undefined}
              className={cx(
                styles.side,
                isSelected && styles.sideSelected,
                !interactive && styles.sideInert,
                isWinner && styles.sideWinner,
              )}
            >
              {logoUrl ? (
                // Decorative: the label span right after it already
                // announces the team name, so a redundant alt would
                // double-announce to a screen reader. Broken/expired
                // CDN URLs just disappear rather than showing a
                // browser's broken-image icon.
                <img
                  src={logoUrl}
                  alt=""
                  aria-hidden="true"
                  className={styles.sideLogo}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <span className={styles.sideLabel}>{describeSide(team)}</span>
              {isSelected || isWinner ? <CheckIcon size={15} className={styles.sideCheck} /> : null}
            </button>
          );
        })}
      </div>

      <StatusRow state={state} remainingMs={remainingMs} />

      <span role="status" aria-live="polite" className={visuallyHiddenStyles.visuallyHidden}>
        {liveMessage}
      </span>
    </div>
  );
}

function StatusRow({ state, remainingMs }: { state: PickControlState; remainingMs?: number }) {
  switch (state.status) {
    case "open":
      return remainingMs === undefined ? null : (
        <div className={styles.statusRow}>
          <Countdown remainingMs={remainingMs} size="sm" color="dim" />
        </div>
      );
    case "not-yet-open":
      return (
        <div className={styles.statusRow}>
          <NotYetOpenBadge opensAt={state.opensAt} />
        </div>
      );
    case "locked":
      return (
        <div className={styles.statusRow}>
          <LockBadge />
        </div>
      );
    case "final":
      return (
        <div className={styles.statusRow}>
          <ResultBadge outcome={state.outcome} />
        </div>
      );
    case "void":
      return (
        <div className={styles.statusRow}>
          <VoidBadge reason={state.reason} />
        </div>
      );
    case "pending":
      return (
        <div className={styles.statusRow}>
          <Spinner size={14} label="Saving your pick" />
          <Text size="sm" color="dim">
            Saving…
          </Text>
        </div>
      );
    case "queued":
      return (
        <div className={cx(styles.statusRow, styles.queuedMarker)}>
          <CloudOffIcon size={14} />
          <Text size="sm" color="dim">
            Not saved — will sync when back online
          </Text>
        </div>
      );
    case "rejected":
      return (
        <div className={cx(styles.statusRow, styles.rejectionMessage)}>
          <Text size="sm" weight="medium" color="error">
            {describeSide(state.attempted)} wasn&rsquo;t saved: {state.message}
          </Text>
        </div>
      );
  }
}
