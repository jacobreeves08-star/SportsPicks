import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { NotYetOpenBadge } from "./NotYetOpenBadge.js";

describe("NotYetOpenBadge", () => {
  it("renders 'Opens' followed by a formatted date", () => {
    render(<NotYetOpenBadge opensAt="2026-08-20T00:00:00.000Z" />);
    expect(screen.getByText(/^Opens /)).toBeInTheDocument();
  });

  it("falls back to 'soon' for an unparseable opensAt rather than throwing", () => {
    render(<NotYetOpenBadge opensAt="not-a-date" />);
    expect(screen.getByText("Opens soon")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<NotYetOpenBadge opensAt="2026-08-20T00:00:00.000Z" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
