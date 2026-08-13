import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Surface } from "./Surface.js";

describe("Surface", () => {
  it("renders in the requested element with a role passed through", () => {
    render(
      <Surface as="article" role="group" aria-label="Game row">
        content
      </Surface>,
    );
    const el = screen.getByRole("group", { name: "Game row" });
    expect(el.tagName).toBe("ARTICLE");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Surface variant="raised" radius="lg" elevation={2} padding={4}>
        content
      </Surface>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
