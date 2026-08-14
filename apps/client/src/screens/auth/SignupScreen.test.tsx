import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors.js";
import { getDetectedTimezone } from "../../timezone/timezones.js";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({ signup: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignupScreen", () => {
  it("pre-fills the timezone field from the browser", async () => {
    await renderRouteAt("/signup");
    const select = await screen.findByLabelText("Timezone");
    expect(select).toHaveValue(getDetectedTimezone());
  });

  it("explains why the timezone matters, not just collects it silently", async () => {
    await renderRouteAt("/signup");
    expect(await screen.findByText(/when your picks lock and when your daily standings reset/i)).toBeInTheDocument();
  });

  it("blocks submission locally for a too-short password, without calling the API", async () => {
    const { signup } = await import("../../api/endpoints.js");
    await renderRouteAt("/signup");

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Must be at least 8 characters.")).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("submits and shows the server's own confirmation message on success", async () => {
    const { signup } = await import("../../api/endpoints.js");
    vi.mocked(signup).mockResolvedValue({ message: "Check your email to verify your account." });

    await renderRouteAt("/signup");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Check your email to verify your account.")).toBeInTheDocument();
    expect(signup).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password123",
      displayName: "Test",
      timezone: getDetectedTimezone(),
    });
  });

  it("maps a VALIDATION_ERROR field onto the timezone field", async () => {
    const { signup } = await import("../../api/endpoints.js");
    vi.mocked(signup).mockRejectedValue(
      new ApiError(
        { code: "VALIDATION_ERROR", message: "Request failed validation", fields: [{ field: "timezone", message: "must be a valid IANA time zone" }] },
        400,
      ),
    );

    await renderRouteAt("/signup");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("must be a valid IANA time zone")).toBeInTheDocument();
  });

  it(
    "has no axe violations",
    async () => {
      // Longer timeout: the timezone <select> renders ~400 <option>
      // elements (a real IANA zone list, not a test artifact), and
      // axe-core's scan takes noticeably longer over that much DOM
      // than Vitest's 5s default.
      await renderRouteAt("/signup");
      await waitFor(() => screen.getByLabelText("Email"));
      expect(await axe(document.body)).toHaveNoViolations();
    },
    15000,
  );
});
