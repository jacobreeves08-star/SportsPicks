import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { HeadToHeadGame, HeadToHeadResponse, LeagueHomeEntry, OpsSummary, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getHeadToHead: vi.fn(),
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
    record: { wins: 0, losses: 0 },
    gamesParticipated: 0,
    rank: 1,
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

function game(overrides: Partial<HeadToHeadGame> = {}): HeadToHeadGame {
  return {
    gameId: "game-1",
    homeTeam: "Bills",
    awayTeam: "Jets",
    startsAt: "2026-08-13T18:00:00.000Z",
    winningTeam: "Bills",
    picks: [
      { leagueMemberId: "member-1", displayName: "Alice", selectedTeam: "Bills", hit: true },
      { leagueMemberId: "member-2", displayName: "Bob", selectedTeam: "Bills", hit: true },
    ],
    split: false,
    allWrong: false,
    ...overrides,
  };
}

function headToHead(games: HeadToHeadGame[]): HeadToHeadResponse {
  return { date: "2026-08-13", games };
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

describe("HeadToHeadScreen", () => {
  it("renders a grid of games x members with each pick and its hit/miss", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(headToHead([game()]));

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");

    expect(await screen.findByRole("columnheader", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Bills vs Jets/ })).toBeInTheDocument();
    expect(screen.getAllByText("Correct")).toHaveLength(2);
  });

  it("highlights a split game with an explicit badge, not just color", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(
      headToHead([
        game({
          split: true,
          picks: [
            { leagueMemberId: "member-1", displayName: "Alice", selectedTeam: "Bills", hit: true },
            { leagueMemberId: "member-2", displayName: "Bob", selectedTeam: "Jets", hit: false },
          ],
        }),
      ]),
    );

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");

    expect(await screen.findByText("SPLIT")).toBeInTheDocument();
  });

  it("highlights a game everyone got wrong with an explicit badge", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(
      headToHead([
        game({
          allWrong: true,
          winningTeam: "Jets",
          picks: [
            { leagueMemberId: "member-1", displayName: "Alice", selectedTeam: "Bills", hit: false },
            { leagueMemberId: "member-2", displayName: "Bob", selectedTeam: "Bills", hit: false },
          ],
        }),
      ]),
    );

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");

    expect(await screen.findByText("EVERYONE MISSED")).toBeInTheDocument();
  });

  it("shows a dash and no hit/miss badge for a member who never picked", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(
      headToHead([
        game({
          picks: [
            { leagueMemberId: "member-1", displayName: "Alice", selectedTeam: "Bills", hit: true },
            { leagueMemberId: "member-2", displayName: "Bob", selectedTeam: null, hit: null },
          ],
        }),
      ]),
    );

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");
    await screen.findByRole("columnheader", { name: "Bob" });

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("Correct")).toHaveLength(1); // only Alice's cell
  });

  it("shows an empty state when nothing has locked yet on this day", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(headToHead([]));

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");

    expect(await screen.findByText("Nothing locked yet")).toBeInTheDocument();
  });

  it("date navigation links point at the adjacent calendar days", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(headToHead([game()]));

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");
    await screen.findByRole("columnheader", { name: "Alice" });

    expect(screen.getByRole("link", { name: "Previous day" })).toHaveAttribute("href", "/leagues/league-1/head-to-head/2026-08-12");
    expect(screen.getByRole("link", { name: "Next day" })).toHaveAttribute("href", "/leagues/league-1/head-to-head/2026-08-14");
  });

  it("shows an error state with retry on load failure", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(headToHead([game()]));

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");

    expect(await screen.findByText("Couldn't load head-to-head.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("columnheader", { name: "Alice" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    await mockShell();
    const { getHeadToHead } = await import("../api/endpoints.js");
    vi.mocked(getHeadToHead).mockResolvedValue(headToHead([game({ split: true })]));

    await renderRouteAt("/leagues/league-1/head-to-head/2026-08-13");
    await screen.findByRole("columnheader", { name: "Alice" });

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
