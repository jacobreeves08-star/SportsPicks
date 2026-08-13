import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Stack } from "./Stack.js";

describe("Stack", () => {
  it("renders children inside the requested element", () => {
    render(
      <Stack as="ul" data-testid="stack">
        <li>one</li>
        <li>two</li>
      </Stack>,
    );
    expect(screen.getByText("one").parentElement?.tagName).toBe("UL");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Stack direction="row" gap={4} align="center" justify="between" wrap>
        <span>a</span>
        <span>b</span>
      </Stack>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
