import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState.js";

describe("ErrorState", () => {
  it("announces the message via role=alert", () => {
    render(<ErrorState message="Couldn't load the slate." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the slate.");
  });

  it("omits the retry button when no onRetry is given", () => {
    render(<ErrorState message="Couldn't load the slate." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onRetry when the retry button is activated, and owns no fetch logic itself", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Couldn't load the slate." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom retry label", () => {
    render(<ErrorState message="Couldn't submit your pick." onRetry={() => {}} retryLabel="Retry pick" />);
    expect(screen.getByRole("button", { name: "Retry pick" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ErrorState message="Couldn't load the slate." onRetry={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
