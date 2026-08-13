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
