import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { LockBadge } from "./LockBadge.js";

describe("LockBadge", () => {
  it("shows the word 'Locked', not just a colored icon", () => {
    render(<LockBadge />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<LockBadge />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
