import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { LeagueHomeEntry, LeagueWithMemberCount, OpsSummary, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests, setCurrentLeagueId } from "../leagues/current-league-store.js";
import { resetQueueForTests } from "../offline/queue.js";
import { createAppRouter } from "../routes/route-tree.js";

vi.mock("../api/endpoints.js", () => ({
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getSlate: vi.fn(),
  getMe: vi.fn(),
  getLeague: vi.fn(),
  getResultsDigest: vi.fn(),
}));

const ME: UserProfile = {
  id: "user-1",
  email: "me@example.com",
  displayName: "Me",
  timezone: "America/Chicago",
  avatarUrl: null,
  emailVerifiedAt: "2026-08-01T00:00:00.000Z",
  pendingEmail: null,
  deletionRequestedAt: null,
  scheduledDeletionAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  notificationsEnabled: true,
};

function leagueDetail(overrides: Partial<LeagueWithMemberCount> = {}): LeagueWithMemberCount {
  return {
    id: "league-1",
    name: "AFC League",
    sports: ["nfl"],
    commissionerId: "someone-else",
    timezone: "America/Chicago",
    seasonStart: "2026-09-01",
    pickHorizonDays: 7,
    golfPickCount: 3,
    golfTopN: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 4,
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

function league(overrides: Partial<LeagueHomeEntry> = {}): LeagueHomeEntry {
  return {
    id: "league-1",
    leagueMemberId: "member-1",
    name: "Test League",
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

async function renderShellAt(path: string, leagueDetailOverrides: Partial<LeagueWithMemberCount> = {}) {
  const { getMyLeagues, getDataFreshness, pingHealth, getSlate, getMe, getLeague, getResultsDigest } = await import(
    "../api/endpoints.js"
  );
  vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1", name: "AFC League" }), league({ id: "league-2", name: "NFC League" })]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
  vi.mocked(getSlate).mockResolvedValue({ date: "2026-08-13", games: [], pickedCount: 0, totalCount: 0 });
  vi.mocked(getMe).mockResolvedValue(ME);
  vi.mocked(getLeague).mockResolvedValue(leagueDetail(leagueDetailOverrides));
  // Empty by default — none of AppShell's own tests are about the
  // results-digest pop-up, and a populated response would render it
  // over everything else being asserted on.
  vi.mocked(getResultsDigest).mockResolvedValue({ leagues: [] });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  resetQueueForTests();
  localStorage.clear();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
});

afterEach(() => {
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  resetQueueForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("AppShell — mounted via the real authenticated route guard", () => {
  it("renders the bottom nav with all four destinations", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveTextContent("Home");
    expect(nav).toHaveTextContent("Slate");
    expect(nav).toHaveTextContent("Standings");
    expect(nav).toHaveTextContent("Profile");
  });

  it("renders the league switcher populated from useMyLeagues", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13");

    const switcher = await screen.findByRole("combobox", { name: "Switch league" });
    expect(switcher).toHaveDisplayValue("AFC League");
    expect(screen.getByRole("option", { name: "NFC League" })).toBeInTheDocument();
  });

  it("shows no banner when everything is healthy and nothing is queued", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13");

    await waitFor(() => {
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/trouble reaching/i)).not.toBeInTheDocument();
    });
  });

  it("renders the matched screen's real content inside the shell", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13");

    expect(await screen.findByText("No games")).toBeInTheDocument();
  });

  it("redirects to /login when the guard fails, and renders no shell chrome there", async () => {
    resetAuthStoreForTests(); // logged out
    await renderShellAt("/leagues/league-1/slate/2026-08-13");

    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("shows the league settings link for the current league's commissioner", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13", { commissionerId: ME.id });

    expect(await screen.findByRole("link", { name: "League settings" })).toBeInTheDocument();
  });

  it("hides the league settings link for a non-commissioner", async () => {
    setCurrentLeagueId("league-1");
    await renderShellAt("/leagues/league-1/slate/2026-08-13"); // leagueDetail() defaults commissionerId to someone else

    await screen.findByRole("navigation", { name: "Primary" });
    expect(screen.queryByRole("link", { name: "League settings" })).not.toBeInTheDocument();
  });
});
