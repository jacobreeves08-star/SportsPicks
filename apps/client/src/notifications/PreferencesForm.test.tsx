import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.js";
import type { LeagueHomeEntry, UserProfile } from "../api/types.js";
import { PreferencesForm } from "./PreferencesForm.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  updateGlobalNotifications: vi.fn(),
  updateLeagueNotifications: vi.fn(),
}));

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
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
    ...overrides,
  };
}

function league(overrides: Partial<LeagueHomeEntry> = {}): LeagueHomeEntry {
  return {
    id: "league-1",
    leagueMemberId: "member-1",
    name: "AFC League",
    sports: ["nfl"],
    memberCount: 4,
    record: { wins: 0, losses: 0 },
    gamesParticipated: 0,
    rank: 1,
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<PreferencesForm />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PreferencesForm", () => {
  it("renders nothing until the profile has loaded", async () => {
    const { getMe, getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockImplementation(() => new Promise(() => {}));
    vi.mocked(getMyLeagues).mockResolvedValue([]);

    const { container } = renderForm();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the global toggle reflecting the real current preference", async () => {
    const { getMe, getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile({ notificationsEnabled: false }));
    vi.mocked(getMyLeagues).mockResolvedValue([]);

    renderForm();

    const checkbox = await screen.findByRole("checkbox", { name: "Email notifications" });
    expect(checkbox).not.toBeChecked();
  });

  it("flipping the global toggle calls the real endpoint", async () => {
    const { getMe, getMyLeagues, updateGlobalNotifications } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile({ notificationsEnabled: true }));
    vi.mocked(getMyLeagues).mockResolvedValue([]);
    vi.mocked(updateGlobalNotifications).mockResolvedValue({ notificationsEnabled: false });

    renderForm();
    const checkbox = await screen.findByRole("checkbox", { name: "Email notifications" });
    fireEvent.click(checkbox);

    await waitFor(() => expect(updateGlobalNotifications).toHaveBeenCalledWith(false));
  });

  it("lists a per-league toggle for every league, defaulting to on", async () => {
    const { getMe, getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile());
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1", name: "AFC League" }), league({ id: "league-2", name: "NFC League" })]);

    renderForm();

    const afc = await screen.findByRole("checkbox", { name: "AFC League notifications" });
    const nfc = await screen.findByRole("checkbox", { name: "NFC League notifications" });
    expect(afc).toBeChecked();
    expect(nfc).toBeChecked();
  });

  it("flipping a per-league toggle calls the endpoint with that league's own memberId", async () => {
    const { getMe, getMyLeagues, updateLeagueNotifications } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile());
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1", leagueMemberId: "member-abc", name: "AFC League" })]);
    vi.mocked(updateLeagueNotifications).mockResolvedValue({ notificationsEnabled: false });

    renderForm();
    const checkbox = await screen.findByRole("checkbox", { name: "AFC League notifications" });
    fireEvent.click(checkbox);

    await waitFor(() => expect(updateLeagueNotifications).toHaveBeenCalledWith("league-1", "member-abc", false));
    expect(checkbox).not.toBeChecked();
  });

  it("reverts a per-league toggle's local state on rejection — never silently shows the failed value as saved", async () => {
    const { getMe, getMyLeagues, updateLeagueNotifications } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile());
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1", leagueMemberId: "member-abc" })]);
    vi.mocked(updateLeagueNotifications).mockRejectedValue(new ApiError({ code: "INTERNAL_ERROR", message: "nope" }, 500));

    renderForm();
    const checkbox = await screen.findByRole("checkbox", { name: "AFC League notifications" });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked()); // reverted back to true after the rejection
  });

  it("disables per-league toggles when the global switch is off", async () => {
    const { getMe, getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile({ notificationsEnabled: false }));
    vi.mocked(getMyLeagues).mockResolvedValue([league()]);

    renderForm();
    const checkbox = await screen.findByRole("checkbox", { name: "AFC League notifications" });
    expect(checkbox).toBeDisabled();
  });

  it("has no axe violations", async () => {
    const { getMe, getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMe).mockResolvedValue(profile());
    vi.mocked(getMyLeagues).mockResolvedValue([league()]);

    const { container } = renderForm();
    await screen.findByRole("checkbox", { name: "Email notifications" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
