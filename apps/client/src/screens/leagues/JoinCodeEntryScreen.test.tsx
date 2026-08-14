import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({ previewInvite: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JoinCodeEntryScreen", () => {
  it("navigates to the canonical /join/:code with the trimmed code on submit", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockImplementation(() => new Promise(() => {}));

    const router = await renderRouteAt("/join");
    fireEvent.change(await screen.findByLabelText("Invite code"), { target: { value: "  ABC123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/join/ABC123"));
  });

  it("does not navigate on an empty code", async () => {
    const router = await renderRouteAt("/join");
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(router.state.location.pathname).toBe("/join");
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/join");
    await waitFor(() => screen.getByLabelText("Invite code"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
