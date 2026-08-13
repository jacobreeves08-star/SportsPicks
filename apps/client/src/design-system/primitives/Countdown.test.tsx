import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Countdown } from "./Countdown.js";

describe("Countdown", () => {
  it("formats minutes and seconds, and hides the raw numeral from assistive tech", () => {
    render(<Countdown remainingMs={3 * 60_000 + 45_000} />);
    const numeral = screen.getByText("3:45");
    expect(numeral).toHaveAttribute("aria-hidden", "true");
  });

  it("formats hours when remaining time exceeds 60 minutes", () => {
    render(<Countdown remainingMs={90 * 60_000} />);
    expect(screen.getByText("1:30:00")).toBeInTheDocument();
  });

  it("clamps a negative or zero remaining time to 0:00, never a negative countdown", () => {
    render(<Countdown remainingMs={-5000} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("provides a coarse, screen-reader-only equivalent distinct from the ticking numeral", () => {
    render(<Countdown remainingMs={5 * 60_000} />);
    expect(screen.getByText("Locks in about 5 minutes")).toBeInTheDocument();
  });

  it("says 'less than a minute' rather than '0 minutes' right before lock", () => {
    render(<Countdown remainingMs={30_000} />);
    expect(screen.getByText("Locks in less than a minute")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Countdown remainingMs={125_000} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
