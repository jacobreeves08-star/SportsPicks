import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type {
  LeagueHomeEntry,
  LeagueWithMemberCount,
  OpsSummary,
  SlateGame,
  SlateResponse,
  UserProfile,
  WrittenPick,
} from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { resetQueueForTests } from "../offline/queue.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getSlate: vi.fn(),
  writePick: vi.fn(),
  getLeague: vi.fn(),
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
    memberCount: 4,
    record: { wins: 2, losses: 1 },
    gamesParticipated: 3,
    rank: 1,
    unpickedCount: 1,
    nextLockAt: null,
    ...overrides,
  };
}

function leagueDetail(overrides: Partial<LeagueWithMemberCount> = {}): LeagueWithMemberCount {
  return {
    id: "league-1",
    name: "AFC League",
    sports: ["nfl", "nba"],
    commissionerId: "user-1",
    timezone: "America/Chicago",
    seasonStart: "2026-01-01",
    pickHorizonDays: 7,
    golfPickCount: 3,
    golfTopN: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 4,
    ...overrides,
  };
}

function game(overrides: Partial<SlateGame> = {}): SlateGame {
  return {
    gameId: "game-1",
    sport: "nfl",
    homeTeam: "Bills",
    awayTeam: "Jets",
    homeTeamLogoUrl: null,
    awayTeamLogoUrl: null,
    homeTeamFlagUrl: null,
    awayTeamFlagUrl: null,
    homeTeamColor: null,
    awayTeamColor: null,
    // Well within the default 7-day pick horizon, but still safely in
    // the future relative to whenever this suite actually runs — a
    // fixed far-future literal (the old value here) would now fall
    // OUTSIDE the horizon and derive `not-yet-open` instead of `open`,
    // which every test below assumes.
    startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    status: "scheduled",
    allowsDraw: false,
    winningTeam: null,
    locked: false,
    myPick: null,
    otherPicks: [],
    pickState: "unpicked",
    ...overrides,
  };
}

function slate(games: SlateGame[]): SlateResponse {
  return { date: "2026-08-13", games, pickedCount: games.filter((g) => g.myPick !== null).length, totalCount: games.length };
}

async function mockShell(leagues: LeagueHomeEntry[] = [league()], leagueDetailOverrides: Partial<LeagueWithMemberCount> = {}) {
  const { getMe, getDataFreshness, pingHealth, getMyLeagues, getLeague } = await import("../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(getMyLeagues).mockResolvedValue(leagues);
  vi.mocked(getLeague).mockResolvedValue(leagueDetail(leagueDetailOverrides));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  resetQueueForTests();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
});

describe("SlateScreen", () => {
  it("renders games grouped by sport, with the server's picked-of-total count", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(
      slate([game({ gameId: "nfl-1", sport: "nfl", myPick: "Bills" }), game({ gameId: "nba-1", sport: "nba", homeTeam: "Lakers", awayTeam: "Celtics" })]),
    );

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("1 of 2 picked")).toBeInTheDocument();
    expect(screen.getByText("NFL")).toBeInTheDocument();
    expect(screen.getByText("NBA")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Lakers" })).toBeInTheDocument();
  });

  it("shows an empty state when nothing is on the slate for this day", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(slate([]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("No games")).toBeInTheDocument();
  });

  it("selecting a side writes the pick and lands on open/selected once confirmed", async () => {
    await mockShell();
    const { getSlate, writePick } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(slate([game()]));
    const writtenPick: WrittenPick = { id: "pick-1", leagueMemberId: "member-1", gameId: "game-1", selectedTeam: "Bills", createdAt: "2026-08-13T12:00:00.000Z" };
    vi.mocked(writePick).mockResolvedValue(writtenPick);

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    const billsButton = await screen.findByRole("radio", { name: "Bills" });
    fireEvent.click(billsButton);

    await waitFor(() => expect(billsButton).toHaveAttribute("aria-checked", "true"));
    expect(writePick).toHaveBeenCalledWith("league-1", "member-1", "game-1", "Bills");
  });

  it("renders a game beyond the league's pick horizon as read-only with an opens-on badge", async () => {
    await mockShell([league()], { pickHorizonDays: 2 });
    const { getSlate } = await import("../api/endpoints.js");
    const farGame = game({ startsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() });
    vi.mocked(getSlate).mockResolvedValue(slate([farGame]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText(/^Opens /)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-disabled", "true");
  });

  it("renders a locked game as read-only with a lock badge", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(slate([game({ status: "in_progress", myPick: "Bills", pickState: "locked" })]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-disabled", "true");
  });

  it("renders a final game with hit/miss and the actual winner marked", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(
      slate([game({ status: "final", winningTeam: "Bills", myPick: "Bills", pickState: "final_hit" })]),
    );

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("Correct")).toBeInTheDocument();
  });

  it("date navigation links point at the adjacent calendar days", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(slate([game()]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");
    await screen.findByRole("radio", { name: "Bills" });

    expect(screen.getByRole("link", { name: "Previous day" })).toHaveAttribute("href", "/leagues/league-1/slate/2026-08-12");
    expect(screen.getByRole("link", { name: "Next day" })).toHaveAttribute("href", "/leagues/league-1/slate/2026-08-14");
  });

  it("shows an error state with retry on load failure", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(slate([game()]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("Couldn't load this slate.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("radio", { name: "Bills" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    await mockShell();
    const { getSlate } = await import("../api/endpoints.js");
    vi.mocked(getSlate).mockResolvedValue(slate([game({ myPick: "Bills" })]));

    await renderRouteAt("/leagues/league-1/slate/2026-08-13");
    await screen.findByRole("radio", { name: "Bills" });

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
