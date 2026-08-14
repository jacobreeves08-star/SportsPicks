import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({ requestPasswordReset: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PasswordResetRequestScreen", () => {
  it("shows the server's own message on submit, regardless of whether the account exists", async () => {
    const { requestPasswordReset } = await import("../../api/endpoints.js");
    vi.mocked(requestPasswordReset).mockResolvedValue({
      message: "If an account exists for that email, a reset link has been sent.",
    });

    await renderRouteAt("/password-reset");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("If an account exists for that email, a reset link has been sent.")).toBeInTheDocument();
    expect(requestPasswordReset).toHaveBeenCalledWith("a@example.com");
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/password-reset");
    await waitFor(() => screen.getByLabelText("Email"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
