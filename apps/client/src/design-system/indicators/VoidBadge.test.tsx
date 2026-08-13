import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { VoidBadge } from "./VoidBadge.js";

describe("VoidBadge", () => {
  it("shows distinct text for postponed vs. canceled", () => {
    const { unmount } = render(<VoidBadge reason="postponed" />);
    expect(screen.getByText("Postponed")).toBeInTheDocument();
    unmount();

    render(<VoidBadge reason="canceled" />);
    expect(screen.getByText("Canceled")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<VoidBadge reason="canceled" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
