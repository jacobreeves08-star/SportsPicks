import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Text } from "./Text.js";

describe("Text", () => {
  it("renders its children in the requested element", () => {
    render(<Text as="h2">Standings</Text>);
    expect(screen.getByText("Standings").tagName).toBe("H2");
  });

  it("defaults to a span with default size/weight/color", () => {
    render(<Text>hello</Text>);
    const el = screen.getByText("hello");
    expect(el.tagName).toBe("SPAN");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Text as="p" size="lg" weight="bold" color="dim">
        Some text
      </Text>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
