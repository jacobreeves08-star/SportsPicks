import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { OpsSummary, UserProfile } from "../../api/types.js";
import { renderRouteAt } from "../render-route.js";

// LoginScreen navigates to a PROTECTED route on success, which mounts
// the real AppShell (authenticatedLayoutRoute's component) — so this
// file mocks the same endpoints AppShell.test.tsx does, not just
// `login`. `getMe` is needed too: the returnTo redirect test below
// lands on /profile, which mounts ProfileScreen -> PreferencesForm ->
// useMe() -> getMe() — an unmocked call there throws just as surely
// as an unmocked getMyLeagues() would.
vi.mock("../../api/endpoints.js", () => ({
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
  emailVerifiedAt: "2026-08-13T00:00:00.000Z",
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

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  localStorage.clear();
});

describe("LoginScreen", () => {
  it("on success, stores the tokens and navigates home when there's no returnTo", async () => {
    const { login } = await import("../../api/endpoints.js");
    await mockAppShellDependencies();
    vi.mocked(login).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      accessTokenExpiresAt: "2026-08-13T19:00:00.000Z",
      refreshTokenExpiresAt: "2026-11-11T18:00:00.000Z",
    });

    const router = await renderRouteAt("/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("on success, navigates to the exact preserved returnTo path", async () => {
    const { login } = await import("../../api/endpoints.js");
    await mockAppShellDependencies();
    vi.mocked(login).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      accessTokenExpiresAt: "2026-08-13T19:00:00.000Z",
      refreshTokenExpiresAt: "2026-11-11T18:00:00.000Z",
    });

    const router = await renderRouteAt("/login?returnTo=%2Fprofile");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
  });

  it("shows the server's own message on invalid credentials, without navigating", async () => {
    const { login } = await import("../../api/endpoints.js");
    vi.mocked(login).mockRejectedValue(new ApiError({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401));

    const router = await renderRouteAt("/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("links to signup and password reset", async () => {
    await renderRouteAt("/login");
    expect(await screen.findByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/password-reset");
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/login");
    await waitFor(() => screen.getByLabelText("Email"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
