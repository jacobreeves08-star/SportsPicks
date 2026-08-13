import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("announces a status with a customizable label", () => {
    render(<Spinner label="Loading standings" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading standings");
  });

  it("defaults to a generic 'Loading' label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Spinner />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
