import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { LeagueHomeEntry, OpsSummary, UserProfile } from "../api/types.js";
import { getCurrentLeagueId, resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getSlate: vi.fn(),
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
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

async function mockShell() {
  const { getMe, getDataFreshness, pingHealth } = await import("../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  setAuthTokens({ accessToken: "at", refreshToken: "rt" });
});

describe("HomeScreen", () => {
  it("shows an empty state with create/join actions when the caller has no leagues", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([]);

    await renderRouteAt("/");

    expect(await screen.findByText("No leagues yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a league" })).toHaveAttribute("href", "/leagues/new");
    expect(screen.getByRole("link", { name: "Join a league" })).toHaveAttribute("href", "/join");
  });

  it("renders leagues in the exact order the server returned, never re-sorting client-side", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([
      league({ id: "league-2", name: "Settled League", unpickedCount: 0 }),
      league({ id: "league-1", name: "Urgent League", unpickedCount: 5 }),
    ]);

    await renderRouteAt("/");
    // Wait for the list itself (a link, not the LeagueSwitcher's
    // <option> with the same text) before reading order.
    await screen.findByRole("link", { name: /Urgent League/ });

    const names = screen
      .getAllByRole("link")
      .map((el) => el.textContent)
      .filter((t) => t?.includes("League"));
    const settledIndex = names.findIndex((t) => t?.includes("Settled League"));
    const urgentIndex = names.findIndex((t) => t?.includes("Urgent League"));
    expect(settledIndex).toBeGreaterThan(-1);
    expect(urgentIndex).toBeGreaterThan(-1);
    expect(settledIndex).toBeLessThan(urgentIndex); // exactly the mocked (server) order, not re-sorted
  });

  it("shows the unpicked count prominently, and 'All picked' when there's nothing open", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([
      league({ id: "league-1", name: "Open League", unpickedCount: 3 }),
      league({ id: "league-2", name: "Done League", unpickedCount: 0 }),
    ]);

    await renderRouteAt("/");

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("unpicked")).toBeInTheDocument();
    expect(screen.getByText("All picked")).toBeInTheDocument();
  });

  it("shows a countdown to the next lock when picks are still open", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([
      league({ unpickedCount: 2, nextLockAt: new Date(Date.now() + 5 * 60_000).toISOString() }),
    ]);

    await renderRouteAt("/");

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("tapping a league sets it as current and navigates to that league's slate", async () => {
    await mockShell();
    const { getMyLeagues, getSlate } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([league({ id: "league-1", name: "AFC League" })]);
    vi.mocked(getSlate).mockResolvedValue({ date: "2026-08-13", games: [], pickedCount: 0, totalCount: 0 });

    const router = await renderRouteAt("/");
    fireEvent.click(await screen.findByRole("link", { name: /AFC League/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/leagues/league-1/slate/2026-08-13"));
    expect(getCurrentLeagueId()).toBe("league-1");
  });

  it("shows an error state with retry on load failure", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([league()]);

    await renderRouteAt("/");

    expect(await screen.findByText("Couldn't load your leagues.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: /AFC League/ })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    await mockShell();
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([
      league({ id: "league-1", unpickedCount: 2, nextLockAt: new Date(Date.now() + 5 * 60_000).toISOString() }),
      league({ id: "league-2", name: "Second League", unpickedCount: 0 }),
    ]);

    await renderRouteAt("/");
    await screen.findByRole("link", { name: /AFC League/ });
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
