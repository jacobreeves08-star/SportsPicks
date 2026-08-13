import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { ResultBadge } from "./ResultBadge.js";

describe("ResultBadge", () => {
  it("shows distinct text for hit vs. miss", () => {
    const { unmount } = render(<ResultBadge outcome="hit" />);
    expect(screen.getByText("Correct")).toBeInTheDocument();
    unmount();

    render(<ResultBadge outcome="miss" />);
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
  });

  /**
   * The a11y doc's explicit, testable acceptance criterion: unambiguous
   * in greyscale. jsdom can't render pixels, so this is the
   * automatable proxy — assert the two states differ on every signal
   * OTHER than color (distinct text AND a structurally distinct icon
   * path), which is exactly what survives when color is removed. The
   * real greyscale/device check still happens manually per the a11y
   * doc's own "only verified by picking up a device" note.
   */
  it("is unambiguous with color removed: distinct text AND a distinct icon shape per outcome", () => {
    const { container: hitContainer } = render(<ResultBadge outcome="hit" />);
    const { container: missContainer } = render(<ResultBadge outcome="miss" />);

    const hitText = hitContainer.textContent;
    const missText = missContainer.textContent;
    expect(hitText).not.toBe(missText);

    const hitPath = hitContainer.querySelector("svg path")?.getAttribute("d");
    const missPath = missContainer.querySelector("svg path")?.getAttribute("d");
    expect(hitPath).toBeTruthy();
    expect(missPath).toBeTruthy();
    expect(hitPath).not.toBe(missPath);
  });

  it("marks its icon decorative — the accessible name comes from the text, not the icon", () => {
    render(<ResultBadge outcome="hit" />);
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations", async () => {
    const { container } = render(<ResultBadge outcome="miss" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
