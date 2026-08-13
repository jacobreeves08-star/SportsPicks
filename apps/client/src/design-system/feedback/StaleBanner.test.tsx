import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { StaleBanner } from "./StaleBanner.js";

describe("StaleBanner", () => {
  it("shows an absolute time, not a relative one that would silently go stale itself", () => {
    render(<StaleBanner asOf="2026-08-13T15:04:00.000Z" />);
    // Exact rendered time depends on the test runner's locale/timezone;
    // assert on the always-true structural claim instead of a specific
    // clock string.
    expect(screen.getByRole("status").textContent).toMatch(/^Showing data as of /);
    expect(screen.getByRole("status").textContent).not.toMatch(/ago/);
  });

  it("appends the reason when one is given", () => {
    render(<StaleBanner asOf="2026-08-13T15:04:00.000Z" reason="sports data provider is degraded" />);
    expect(screen.getByRole("status").textContent).toMatch(/sports data provider is degraded$/);
  });

  it("degrades gracefully on an unparseable timestamp rather than showing 'Invalid Date'", () => {
    render(<StaleBanner asOf="not-a-real-timestamp" />);
    expect(screen.getByRole("status").textContent).not.toMatch(/Invalid Date/);
  });

  it("is distinct from LoadingState — this is 'known-old data,' not 'still fetching'", () => {
    render(<StaleBanner asOf="2026-08-13T15:04:00.000Z" />);
    expect(screen.queryByLabelText("Loading slate")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<StaleBanner asOf="2026-08-13T15:04:00.000Z" reason="degraded feed" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
