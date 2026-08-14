import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRouteAt } from "../render-route.js";

// The success/error/missing-token state machine is exhaustively
// covered by VerifyEmailScreen.test.tsx (same shared TokenActionScreen)
// — this file only confirms the screen wires the RIGHT action and copy.
vi.mock("../../api/endpoints.js", () => ({ verifyEmail: vi.fn(), verifyEmailChange: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmailChangeScreen", () => {
  it("calls verifyEmailChange (not verifyEmail) with the token from the URL", async () => {
    const { verifyEmail, verifyEmailChange } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmailChange).mockResolvedValue({ message: "Email updated" });

    await renderRouteAt("/verify-email-change?token=abc123");

    expect(await screen.findByText("Email updated")).toBeInTheDocument();
    expect(verifyEmailChange).toHaveBeenCalledWith("abc123");
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it("shows the email-change-specific title", async () => {
    const { verifyEmailChange } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmailChange).mockResolvedValue({ message: "Email updated" });

    await renderRouteAt("/verify-email-change?token=abc123");
    expect(await screen.findByRole("heading", { name: "Confirm your new email" })).toBeInTheDocument();
  });
});
