import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { LoadingState } from "./LoadingState.js";

describe("LoadingState", () => {
  it("announces a single status, not one per decorative skeleton row", () => {
    render(<LoadingState rows={4} />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute("aria-label", "Loading slate");
  });

  it("accepts a context-specific label", () => {
    render(<LoadingState label="Loading standings" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading standings");
  });

  it("renders the requested number of skeleton rows", () => {
    const { container } = render(<LoadingState rows={5} />);
    // The decorative rows are aria-hidden — query the DOM directly
    // rather than through an accessibility-tree query.
    expect(container.querySelectorAll("[aria-hidden] > *").length).toBe(5);
  });

  it("has no axe violations", async () => {
    const { container } = render(<LoadingState rows={2} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
