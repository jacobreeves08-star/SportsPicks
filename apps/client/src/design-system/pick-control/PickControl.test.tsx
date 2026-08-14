import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { describePickControl } from "./describe-pick-control.js";
import { PickControl } from "./PickControl.js";
import type { PickControlState, PickControlTeams } from "./PickControl.types.js";

const teams: PickControlTeams = {
  homeTeam: "Bills",
  awayTeam: "Jets",
  allowsDraw: false,
  startsAt: "2026-08-13T18:00:00.000Z",
};

const drawTeams: PickControlTeams = { ...teams, homeTeam: "Arsenal", awayTeam: "Chelsea", allowsDraw: true };

const ALL_STATES: PickControlState[] = [
  { status: "open", selected: null },
  { status: "open", selected: "Bills" },
  { status: "not-yet-open", selected: null, opensAt: "2026-08-20T00:00:00.000Z" },
  { status: "locked", selected: "Jets" },
  { status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" },
  { status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" },
  { status: "void", reason: "postponed", selected: null },
  { status: "pending", optimistic: "Bills", previous: null },
  { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "This game already locked." },
  { status: "queued", queued: "Bills", previous: null },
];

describe("PickControl — structure and semantics", () => {
  it("renders exactly two radios for a non-draw game", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("renders a third 'Draw' radio only when allowsDraw is true", () => {
    render(<PickControl teams={drawTeams} state={{ status: "open", selected: null }} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Draw" })).toBeInTheDocument();
  });

  it("the radiogroup's accessible name matches describePickControl exactly", () => {
    const state: PickControlState = { status: "locked", selected: "Jets" };
    render(<PickControl teams={teams} state={state} />);
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(describePickControl(state, teams));
  });

  it("marks the selected side aria-checked, and only that side", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: "Bills" }} />);
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Jets" })).toHaveAttribute("aria-checked", "false");
  });

  it("renders each side's logo image, decoratively, when a logo URL is provided", () => {
    const teamsWithLogos: PickControlTeams = {
      ...teams,
      homeTeamLogoUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
      awayTeamLogoUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png",
    };
    render(<PickControl teams={teamsWithLogos} state={{ status: "open", selected: null }} />);
    const images = screen.getAllByRole("presentation", { hidden: true });
    expect(images).toHaveLength(2);
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
      "https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png",
    ]);
  });

  it("renders no logo image when a URL isn't provided", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} />);
    expect(screen.queryByRole("presentation", { hidden: true })).not.toBeInTheDocument();
  });

  it("fills the selected side in the team's own color, with readable text on top", () => {
    const teamsWithColors: PickControlTeams = { ...teams, homeTeamColor: "0e3386", awayTeamColor: "c41e3a" };
    render(<PickControl teams={teamsWithColors} state={{ status: "open", selected: "Bills" }} />);
    const selected = screen.getByRole("radio", { name: "Bills" });
    expect(selected.style.backgroundColor).toBe("rgb(14, 51, 134)"); // #0e3386
    expect(selected.style.color).toBe("rgb(255, 255, 255)");
    // The unselected side is untouched — no inline color of its own.
    expect(screen.getByRole("radio", { name: "Jets" }).style.backgroundColor).toBe("");
  });

  it("falls back to the plain accent fill when the selected team has no known color", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: "Bills" }} />);
    expect(screen.getByRole("radio", { name: "Bills" }).style.backgroundColor).toBe("");
  });

  it("does NOT team-color a final game's selected-but-not-winning side — the win/loss framing takes over instead", () => {
    const teamsWithColors: PickControlTeams = { ...teams, homeTeamColor: "0e3386", awayTeamColor: "c41e3a" };
    const state: PickControlState = { status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" };
    render(<PickControl teams={teamsWithColors} state={state} />);
    expect(screen.getByRole("radio", { name: "Jets" }).style.backgroundColor).toBe("");
  });

  it("does NOT team-color the winning side either — it stays the standard green hit treatment", () => {
    const teamsWithColors: PickControlTeams = { ...teams, homeTeamColor: "0e3386", awayTeamColor: "c41e3a" };
    const state: PickControlState = { status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" };
    render(<PickControl teams={teamsWithColors} state={state} />);
    expect(screen.getByRole("radio", { name: "Bills" }).style.backgroundColor).toBe("");
  });
});

describe("PickControl — interactivity per status", () => {
  it("open: clicking a side calls onSelect", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: "Jets" }));
    expect(onSelect).toHaveBeenCalledWith("Jets");
  });

  it("locked: clicking a side does NOT call onSelect, and is aria-disabled", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={teams} state={{ status: "locked", selected: "Bills" }} onSelect={onSelect} />);
    const side = screen.getByRole("radio", { name: "Jets" });
    expect(side).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(side);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("not-yet-open: clicking a side does NOT call onSelect, and is aria-disabled", () => {
    const onSelect = vi.fn();
    const state: PickControlState = { status: "not-yet-open", selected: null, opensAt: "2026-08-20T00:00:00.000Z" };
    render(<PickControl teams={teams} state={state} onSelect={onSelect} />);
    const side = screen.getByRole("radio", { name: "Jets" });
    expect(side).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(side);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("locked sides use aria-disabled, never the native disabled attribute — they must stay focusable", () => {
    render(<PickControl teams={teams} state={{ status: "locked", selected: "Bills" }} />);
    const side = screen.getByRole("radio", { name: "Jets" });
    expect(side).not.toBeDisabled();
    expect(side).toHaveAttribute("aria-disabled", "true");
  });

  it("void: clicking a side does NOT call onSelect", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={teams} state={{ status: "void", reason: "canceled", selected: null }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: "Bills" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("rejected: still interactive — a user can immediately retry", () => {
    const onSelect = vi.fn();
    const state: PickControlState = { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "Locked." };
    render(<PickControl teams={teams} state={state} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: "Jets" }));
    expect(onSelect).toHaveBeenCalledWith("Jets");
  });

  it("rejected: shows the REVERTED value as checked, never the failed attempt", () => {
    const state: PickControlState = { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "Locked." };
    render(<PickControl teams={teams} state={state} />);
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Jets" })).toHaveAttribute("aria-checked", "false");
  });

  it("queued: interactive, and shows an unmistakable 'not saved' marker rather than looking done", () => {
    render(<PickControl teams={teams} state={{ status: "queued", queued: "Bills", previous: null }} />);
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("Not saved — will sync when back online")).toBeInTheDocument();
  });
});

describe("PickControl — keyboard navigation", () => {
  it("ArrowRight moves the roving tab stop and selects the next side (native radio behavior)", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={teams} state={{ status: "open", selected: "Bills" }} onSelect={onSelect} />);
    const bills = screen.getByRole("radio", { name: "Bills" });
    const jets = screen.getByRole("radio", { name: "Jets" });
    expect(bills).toHaveAttribute("tabindex", "0");
    expect(jets).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("Jets");
  });

  it("ArrowLeft wraps around from the first side to the last", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={drawTeams} state={{ status: "open", selected: "Arsenal" }} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("DRAW");
  });

  it("arrow keys move the roving focus but do NOT select while non-interactive", () => {
    const onSelect = vi.fn();
    render(<PickControl teams={teams} state={{ status: "locked", selected: "Bills" }} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).not.toHaveBeenCalled();
    // Focus still moves — a screen reader user can still read every side.
    expect(screen.getByRole("radio", { name: "Jets" })).toHaveAttribute("tabindex", "0");
  });

  it("exactly one side is a tab stop at a time, even for a 3-sided draw-eligible game", () => {
    render(<PickControl teams={drawTeams} state={{ status: "open", selected: null }} />);
    const tabbable = screen.getAllByRole("radio").filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });
});

describe("PickControl — status row content", () => {
  it("final: renders a winner marker on the winning side and a ResultBadge", () => {
    render(<PickControl teams={teams} state={{ status: "final", selected: "Bills", winningTeam: "Bills", outcome: "hit" }} />);
    expect(screen.getByText("Correct")).toBeInTheDocument();
  });

  it("final miss renders 'Incorrect'", () => {
    render(<PickControl teams={teams} state={{ status: "final", selected: "Jets", winningTeam: "Bills", outcome: "miss" }} />);
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
  });

  it("not-yet-open renders an opens-on badge, formatted as an absolute date", () => {
    const state: PickControlState = { status: "not-yet-open", selected: null, opensAt: "2026-08-20T00:00:00.000Z" };
    render(<PickControl teams={teams} state={state} />);
    expect(screen.getByText(/^Opens /)).toBeInTheDocument();
  });

  it("void renders the reason-specific badge text", () => {
    render(<PickControl teams={teams} state={{ status: "void", reason: "postponed", selected: null }} />);
    expect(screen.getByText("Postponed")).toBeInTheDocument();
  });

  it("pending renders a saving indicator", () => {
    render(<PickControl teams={teams} state={{ status: "pending", optimistic: "Bills", previous: null }} />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("rejected renders the explanation message, visibly, not just in the live region", () => {
    const state: PickControlState = { status: "rejected", attempted: "Jets", revertedTo: "Bills", message: "This game already locked." };
    render(<PickControl teams={teams} state={state} />);
    expect(screen.getByText(/This game already locked\./)).toBeInTheDocument();
  });

  it("open with remainingMs renders a countdown", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} remainingMs={65_000} />);
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("open without remainingMs renders no countdown row", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} />);
    expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
  });
});

describe("PickControl — live region announces transitions, not initial mount", () => {
  it("stays silent on first render", () => {
    render(<PickControl teams={teams} state={{ status: "open", selected: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces a state transition (e.g. a silent poll-driven lock)", () => {
    const { rerender } = render(<PickControl teams={teams} state={{ status: "open", selected: null }} />);
    const lockedState: PickControlState = { status: "locked", selected: null };
    rerender(<PickControl teams={teams} state={lockedState} />);
    expect(screen.getByText(describePickControl(lockedState, teams))).toBeInTheDocument();
  });
});

describe("PickControl — accessibility scan per state variant", () => {
  it.each(ALL_STATES.map((state) => [state.status, state] as const))("no axe violations: %s", async (_label, state) => {
    const { container } = render(<PickControl teams={teams} state={state} onSelect={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("no axe violations: draw-eligible game", async () => {
    const { container } = render(<PickControl teams={drawTeams} state={{ status: "open", selected: "DRAW" }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
