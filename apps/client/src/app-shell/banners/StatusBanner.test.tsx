import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { CloudOffIcon } from "../../design-system/index.js";
import { StatusBanner } from "./StatusBanner.js";

describe("StatusBanner", () => {
  it("renders the message as visible text", () => {
    render(<StatusBanner icon={<CloudOffIcon />} message="You're offline" tone="warning" />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });

  it("defaults to role=status", () => {
    render(<StatusBanner icon={<CloudOffIcon />} message="You're offline" tone="warning" />);
    expect(screen.getByRole("status")).toHaveTextContent("You're offline");
  });

  it("can be rendered as role=alert for a just-started condition", () => {
    render(<StatusBanner icon={<CloudOffIcon />} message="You're offline" tone="warning" role="alert" />);
    expect(screen.getByRole("alert")).toHaveTextContent("You're offline");
  });

  it("has no axe violations", async () => {
    const { container } = render(<StatusBanner icon={<CloudOffIcon />} message="Reconnecting…" tone="info" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
