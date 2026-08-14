import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { LeagueHomeEntry, OpsSummary, StandingsEntry, StandingsResponse, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getStandings: vi.fn(),
}));

const PROFILE: UserProfile = {
  id: "user-1",
  email: "a@example.com",
  displayName: "Test",
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

function league(overrides: Partial<LeagueHomeEntry> = {}): LeagueHomeEntry {
  return {
    id: "league-1",
    leagueMemberId: "member-1",
    name: "AFC League",
    sports: ["nfl"],
    memberCount: 2,
    record: { wins: 2, losses: 1 },
    gamesParticipated: 3,
    rank: 1,
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<StandingsEntry> = {}): StandingsEntry {
  return {
    leagueMemberId: "member-1",
    userId: "user-1",
    displayName: "Alice",
    wins: 2,
    losses: 1,
    gamesParticipated: 3,
    winPct: 2 / 3,
    rank: 1,
    rankChange: 1,
    ...overrides,
  };
}

function standings(entries: StandingsEntry[], overrides: Partial<StandingsResponse> = {}): StandingsResponse {
  return { timeframe: "today", date: "2026-08-13", callerLeagueMemberId: "member-1", standings: entries, ...overrides };
}

async function mockShell() {
  const { getMe, getDataFreshness, pingHealth, getMyLeagues } = await import("../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(getMyLeagues).mockResolvedValue([league()]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
});

describe("StandingsScreen", () => {
  it("renders the ranked list with record, win%, games played, and rank change", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(
      standings([entry(), entry({ leagueMemberId: "member-2", displayName: "Bob", rank: 2, wins: 1, losses: 2, winPct: 1 / 3, rankChange: -1 })]),
    );

    await renderRouteAt("/leagues/league-1/standings");

    expect(await screen.findByText("Alice (you)")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("2-1")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getAllByText("3 GP")).toHaveLength(2); // both entries default to gamesParticipated: 3
  });

  it("marks the current user's row distinctly from other members", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(
      standings([entry(), entry({ leagueMemberId: "member-2", displayName: "Bob", rank: 2 })]),
    );

    await renderRouteAt("/leagues/league-1/standings");

    const me = await screen.findByText("Alice (you)");
    expect(screen.queryByText("Bob (you)")).not.toBeInTheDocument();
    expect(me).toBeInTheDocument();
  });

  it("switching the timeframe tab requests standings for that timeframe", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(standings([entry()]));

    await renderRouteAt("/leagues/league-1/standings");
    await screen.findByText("Alice (you)");

    fireEvent.click(screen.getByRole("tab", { name: "This week" }));

    await screen.findByText("Alice (you)");
    expect(getStandings).toHaveBeenCalledWith("league-1", { timeframe: "week" });
  });

  it("tapping a member's row links to head-to-head for the standings' anchor date", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(standings([entry()], { date: "2026-08-11" }));

    await renderRouteAt("/leagues/league-1/standings");

    const row = await screen.findByRole("link", { name: /Alice/ });
    expect(row).toHaveAttribute("href", "/leagues/league-1/head-to-head/2026-08-11");
  });

  it("shows an empty state when nobody has picked yet", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(standings([]));

    await renderRouteAt("/leagues/league-1/standings");

    expect(await screen.findByText("No standings yet")).toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(standings([entry()]));

    await renderRouteAt("/leagues/league-1/standings");

    expect(await screen.findByText("Couldn't load standings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Alice (you)")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    await mockShell();
    const { getStandings } = await import("../api/endpoints.js");
    vi.mocked(getStandings).mockResolvedValue(
      standings([entry(), entry({ leagueMemberId: "member-2", displayName: "Bob", rank: 2, rankChange: null })]),
    );

    await renderRouteAt("/leagues/league-1/standings");
    await screen.findByText("Alice (you)");

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
