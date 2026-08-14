import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors.js";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({ confirmPasswordReset: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PasswordResetConfirmScreen", () => {
  it("shows an error and no form when the URL has no token", async () => {
    await renderRouteAt("/password-reset/confirm");
    expect(await screen.findByText(/missing a reset code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/password-reset");
  });

  it("blocks submission locally for a too-short password, without calling the API", async () => {
    const { confirmPasswordReset } = await import("../../api/endpoints.js");
    await renderRouteAt("/password-reset/confirm?token=abc123");

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Must be at least 8 characters.")).toBeInTheDocument();
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("submits the token from the URL and shows success", async () => {
    const { confirmPasswordReset } = await import("../../api/endpoints.js");
    vi.mocked(confirmPasswordReset).mockResolvedValue({ message: "Password reset" });

    await renderRouteAt("/password-reset/confirm?token=abc123");
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "newpassword1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password reset You can now log in.")).toBeInTheDocument();
    expect(confirmPasswordReset).toHaveBeenCalledWith({ token: "abc123", newPassword: "newpassword1" });
  });

  it("on an expired token, offers a link to request a new one", async () => {
    const { confirmPasswordReset } = await import("../../api/endpoints.js");
    vi.mocked(confirmPasswordReset).mockRejectedValue(
      new ApiError({ code: "INVALID_OR_EXPIRED_TOKEN", message: "Invalid or expired reset link" }, 400),
    );

    await renderRouteAt("/password-reset/confirm?token=stale");
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "newpassword1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Invalid or expired reset link")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/password-reset");
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/password-reset/confirm?token=abc123");
    await waitFor(() => screen.getByLabelText("New password"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
