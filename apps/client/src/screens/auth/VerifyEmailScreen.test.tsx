import { screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors.js";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({ verifyEmail: vi.fn(), verifyEmailChange: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyEmailScreen", () => {
  it("shows an error and never calls the API when the URL has no token", async () => {
    const { verifyEmail } = await import("../../api/endpoints.js");
    await renderRouteAt("/verify-email");

    expect(await screen.findByText(/missing a verification code/i)).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it("calls verifyEmail with the token from the URL and shows the server's success message", async () => {
    const { verifyEmail } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmail).mockResolvedValue({ message: "Email verified" });

    await renderRouteAt("/verify-email?token=abc123");

    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledWith("abc123");
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("calls the endpoint at most once even across re-renders (never re-consumes the single-use token)", async () => {
    const { verifyEmail } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmail).mockResolvedValue({ message: "Email verified" });

    await renderRouteAt("/verify-email?token=abc123");
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));

    // A settled promise flushing microtasks / a re-render from React
    // strict-mode-like double invocation must not trigger a second call.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error message on an invalid or expired token", async () => {
    const { verifyEmail } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError({ code: "INVALID_OR_EXPIRED_TOKEN", message: "Invalid or expired verification link" }, 400));

    await renderRouteAt("/verify-email?token=stale");

    expect(await screen.findByText("Invalid or expired verification link")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to login" })).toHaveAttribute("href", "/login");
  });

  it("has no axe violations in the success state", async () => {
    const { verifyEmail } = await import("../../api/endpoints.js");
    vi.mocked(verifyEmail).mockResolvedValue({ message: "Email verified" });

    await renderRouteAt("/verify-email?token=abc123");
    await screen.findByText("Email verified");
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
