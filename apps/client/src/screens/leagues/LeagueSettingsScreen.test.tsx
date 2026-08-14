import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../../api/auth-store.js";
import type { LeagueHomeEntry, LeagueWithMemberCount, OpsSummary, UserProfile } from "../../api/types.js";
import { resetCurrentLeagueForTests, setCurrentLeagueId } from "../../leagues/current-league-store.js";
import { renderRouteAt } from "../render-route.js";

// LeagueSettingsScreen sits under authenticatedLayoutRoute (via
// leagueLayoutRoute), so it mounts the real AppShell — same mock set
// as CreateLeagueScreen.test.tsx, plus getLeague/updateLeague for this
// screen's own load -> edit -> save flow.
vi.mock("../../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getSlate: vi.fn(),
  getLeague: vi.fn(),
  updateLeague: vi.fn(),
}));

const COMMISSIONER: UserProfile = {
  id: "user-1",
  email: "commish@example.com",
  displayName: "Commish",
  timezone: "America/Chicago",
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

function homeEntry(overrides: Partial<LeagueHomeEntry> = {}): LeagueHomeEntry {
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

function leagueDetail(overrides: Partial<LeagueWithMemberCount> = {}): LeagueWithMemberCount {
  return {
    id: "league-1",
    name: "AFC League",
    sports: ["nfl"],
    commissionerId: COMMISSIONER.id,
    timezone: "America/Chicago",
    seasonStart: "2026-09-01",
    pickHorizonDays: 7,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 4,
    ...overrides,
  };
}

async function mockShell(leagueOverrides: Partial<LeagueWithMemberCount> = {}) {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth, getLeague } = await import("../../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(COMMISSIONER);
  vi.mocked(getMyLeagues).mockResolvedValue([homeEntry()]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(getLeague).mockResolvedValue(leagueDetail(leagueOverrides));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
  setCurrentLeagueId("league-1");
});

describe("LeagueSettingsScreen", () => {
  it("loads the league's current name, sports, and pick horizon into the form", async () => {
    await mockShell({ name: "AFC League", sports: ["nfl", "nba"], pickHorizonDays: 3 });
    await renderRouteAt("/leagues/league-1/settings");

    expect(await screen.findByLabelText("Name")).toHaveValue("AFC League");
    expect(screen.getByRole("checkbox", { name: "NFL" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "NBA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "MLB" })).not.toBeChecked();
    expect(screen.getByLabelText("Pick horizon")).toHaveValue("3");
  });

  it("saves the updated name, sports, and pick horizon via PATCH", async () => {
    await mockShell();
    const { updateLeague } = await import("../../api/endpoints.js");
    vi.mocked(updateLeague).mockResolvedValue(leagueDetail({ name: "AFC League Redux", pickHorizonDays: 14 }));

    await renderRouteAt("/leagues/league-1/settings");
    await screen.findByLabelText("Name");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "AFC League Redux" } });
    fireEvent.change(screen.getByLabelText("Pick horizon"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updateLeague).toHaveBeenCalledWith("league-1", { name: "AFC League Redux", sports: ["nfl"], pickHorizonDays: 14 }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("blocks submission locally when every sport is unchecked", async () => {
    await mockShell();
    const { updateLeague } = await import("../../api/endpoints.js");

    await renderRouteAt("/leagues/league-1/settings");
    fireEvent.click(await screen.findByRole("checkbox", { name: "NFL" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("Pick at least one sport.")).toBeInTheDocument();
    expect(updateLeague).not.toHaveBeenCalled();
  });

  it("shows an access-denied message for a non-commissioner, instead of the form", async () => {
    await mockShell({ commissionerId: "someone-else" });
    await renderRouteAt("/leagues/league-1/settings");

    expect(await screen.findByText("Only the league commissioner can edit these settings.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});
