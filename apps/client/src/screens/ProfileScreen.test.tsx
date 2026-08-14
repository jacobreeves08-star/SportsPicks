import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import { ApiError } from "../api/errors.js";
import type { OpsSummary, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  updateMe: vi.fn(),
  requestEmailChange: vi.fn(),
  changePassword: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
  updateGlobalNotifications: vi.fn(),
  updateLeagueNotifications: vi.fn(),
}));

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    email: "alice@example.com",
    displayName: "Alice",
    timezone: "America/Chicago",
    avatarUrl: null,
    emailVerifiedAt: "2026-08-01T00:00:00.000Z",
    pendingEmail: null,
    deletionRequestedAt: null,
    scheduledDeletionAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    notificationsEnabled: true,
    ...overrides,
  };
}

const HEALTHY_SUMMARY: OpsSummary = {
  jobs: [],
  staleGameCount: 0,
  correctionsLast24h: 0,
  signupsLast24h: 0,
  picksLast24h: 0,
  slateCompletionRates: [],
  generatedAt: "2026-08-13T18:00:00.000Z",
};

async function mockShell(me: UserProfile) {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(me);
  vi.mocked(getMyLeagues).mockResolvedValue([]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
});

describe("ProfileScreen", () => {
  it("renders the caller's current profile fields", async () => {
    await mockShell(profile());
    await renderRouteAt("/profile");

    expect(await screen.findByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", async () => {
    const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(profile());
    vi.mocked(getMyLeagues).mockResolvedValue([]);
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });

    await renderRouteAt("/profile");

    expect(await screen.findByText("Couldn't load your profile.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByDisplayValue("Alice")).toBeInTheDocument();
  });

  it("saving the profile form shows the server's timezone-change warning", async () => {
    await mockShell(profile());
    const { updateMe } = await import("../api/endpoints.js");
    vi.mocked(updateMe).mockResolvedValue({
      ...profile({ timezone: "America/New_York" }),
      warning: "Changing your timezone affects when picks lock for you going forward.",
    });

    await renderRouteAt("/profile");
    await screen.findByDisplayValue("Alice");

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText(/Changing your timezone affects when picks lock/)).toBeInTheDocument();
    expect(updateMe).toHaveBeenCalledWith({ displayName: "Alice", avatarUrl: undefined, timezone: "America/Chicago" });
  });

  it("requesting an email change shows the pending-confirmation state after refetch", async () => {
    const { getMe, getMyLeagues, getDataFreshness, pingHealth, requestEmailChange } = await import("../api/endpoints.js");
    let fetchCount = 0;
    vi.mocked(getMe).mockImplementation(async () => {
      fetchCount += 1;
      return fetchCount === 1 ? profile() : profile({ pendingEmail: "new@example.com" });
    });
    vi.mocked(getMyLeagues).mockResolvedValue([]);
    vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
    vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
    vi.mocked(requestEmailChange).mockResolvedValue({ message: "Check your new email to confirm the change." });

    await renderRouteAt("/profile");
    await screen.findByDisplayValue("Alice");

    fireEvent.change(screen.getByLabelText("New email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    expect(await screen.findByText("Check your new email to confirm the change.")).toBeInTheDocument();
    expect(await screen.findByText(/Confirmation sent to new@example.com/)).toBeInTheDocument();
  });

  it("changing the password surfaces CURRENT_PASSWORD_INCORRECT as a calm message", async () => {
    await mockShell(profile());
    const { changePassword } = await import("../api/endpoints.js");
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError({ code: "CURRENT_PASSWORD_INCORRECT", message: "Current password is incorrect" }, 401),
    );

    await renderRouteAt("/profile");
    await screen.findByDisplayValue("Alice");

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpassword123" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });

  it("requires a two-step confirm before requesting account deletion", async () => {
    await mockShell(profile());
    const { requestAccountDeletion } = await import("../api/endpoints.js");
    vi.mocked(requestAccountDeletion).mockResolvedValue({
      message: "Account scheduled for deletion",
      scheduledDeletionAt: "2026-09-13T00:00:00.000Z",
    });

    await renderRouteAt("/profile");
    await screen.findByDisplayValue("Alice");

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(requestAccountDeletion).not.toHaveBeenCalled();

    expect(await screen.findByText(/Are you sure/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));

    await waitFor(() => expect(requestAccountDeletion).toHaveBeenCalled());
    expect(await screen.findByText(/You've been signed out of this device/)).toBeInTheDocument();
  });

  it("shows a cancel-deletion action when deletion is already pending", async () => {
    await mockShell(profile({ deletionRequestedAt: "2026-08-13T00:00:00.000Z", scheduledDeletionAt: "2026-09-13T00:00:00.000Z" }));
    const { cancelAccountDeletion } = await import("../api/endpoints.js");
    vi.mocked(cancelAccountDeletion).mockResolvedValue({ message: "Deletion canceled" });

    await renderRouteAt("/profile");

    expect(await screen.findByText(/scheduled for deletion/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));

    await waitFor(() => expect(cancelAccountDeletion).toHaveBeenCalled());
  });

  it("has no axe violations", async () => {
    await mockShell(profile());
    await renderRouteAt("/profile");
    await screen.findByDisplayValue("Alice");

    expect(await axe(document.body)).toHaveNoViolations();
  }, 15000);
});
