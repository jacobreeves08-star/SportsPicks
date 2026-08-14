import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { OpsSummary, UserProfile } from "../../api/types.js";
import { getDetectedTimezone } from "../../timezone/timezones.js";
import { renderRouteAt } from "../render-route.js";

// SignupScreen auto-logs-in on a successful signup (no email
// verification gate — see SignupScreen.tsx), which navigates to a
// PROTECTED route and mounts the real AppShell, so this file mocks the
// same endpoints AppShell.test.tsx/LoginScreen.test.tsx do, not just
// `signup`.
vi.mock("../../api/endpoints.js", () => ({
  signup: vi.fn(),
  login: vi.fn(),
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
}));

const PROFILE: UserProfile = {
  id: "user-1",
  email: "a@example.com",
  displayName: "Test",
  timezone: "UTC",
  avatarUrl: null,
  emailVerifiedAt: null,
  pendingEmail: null,
  deletionRequestedAt: null,
  scheduledDeletionAt: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  notificationsEnabled: true,
};

const HEALTHY_SUMMARY: OpsSummary = {
  jobs: [],
  staleGameCount: 0,
  correctionsLast24h: 0,
  signupsLast24h: 0,
  picksLast24h: 0,
  slateCompletionRates: [],
  generatedAt: "2026-08-13T18:00:00.000Z",
};

async function mockAppShellDependencies() {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getMyLeagues).mockResolvedValue([]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
}

const AUTH_TOKENS = {
  accessToken: "at",
  refreshToken: "rt",
  accessTokenExpiresAt: "2026-08-13T19:00:00.000Z",
  refreshTokenExpiresAt: "2026-11-11T18:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  localStorage.clear();
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

  it("on success, auto-logs in with the just-submitted credentials and navigates into the app — no verification gate", async () => {
    const { signup, login } = await import("../../api/endpoints.js");
    vi.mocked(signup).mockResolvedValue({ message: "Check your email to verify your account." });
    vi.mocked(login).mockResolvedValue(AUTH_TOKENS);
    await mockAppShellDependencies();

    const router = await renderRouteAt("/signup");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: "a@example.com", password: "password123" }));
    expect(signup).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password123",
      displayName: "Test",
      timezone: getDetectedTimezone(),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("falls back to the 'check your email' screen if auto-login fails after a successful signup", async () => {
    const { signup, login } = await import("../../api/endpoints.js");
    vi.mocked(signup).mockResolvedValue({ message: "Check your email to verify your account." });
    vi.mocked(login).mockRejectedValue(new ApiError({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401));

    await renderRouteAt("/signup");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Check your email to verify your account.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to login" })).toBeInTheDocument();
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
