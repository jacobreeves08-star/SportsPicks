import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { NumericText } from "./NumericText.js";

describe("NumericText", () => {
  it("renders as an inline span", () => {
    render(<NumericText>12-3</NumericText>);
    expect(screen.getByText("12-3").tagName).toBe("SPAN");
  });

  it("forces tabular numerals", () => {
    render(<NumericText>#4</NumericText>);
    // font-variant-numeric isn't computed under jsdom (no real layout
    // engine), so this asserts on the class the component applies
    // rather than a computed style — the CSS itself is what actually
    // enforces tabular-nums; Text.module.css owns that rule.
    expect(screen.getByText("#4").className).toMatch(/tabular/);
  });

  it("has no axe violations", async () => {
    const { container } = render(<NumericText color="hit">7-1</NumericText>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
