import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders the title and optional description", () => {
    render(<EmptyState title="No leagues yet" description="Join one with an invite link." />);
    expect(screen.getByText("No leagues yet")).toBeInTheDocument();
    expect(screen.getByText("Join one with an invite link.")).toBeInTheDocument();
  });

  it("omits the description entirely when not given, rather than rendering an empty element", () => {
    const { container } = render(<EmptyState title="No leagues yet" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders an action slot without owning any navigation logic itself", () => {
    render(<EmptyState title="No leagues yet" action={<button type="button">Join a league</button>} />);
    expect(screen.getByRole("button", { name: "Join a league" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<EmptyState title="No leagues yet" description="Join one." />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
