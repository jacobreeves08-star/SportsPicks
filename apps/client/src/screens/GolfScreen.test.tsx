import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { GolfCurrentResponse, LeagueHomeEntry, OpsSummary, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getCurrentGolf: vi.fn(),
  putGolfPick: vi.fn(),
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
    name: "Golf League",
    sports: ["golf"],
    memberCount: 2,
    record: { wins: 0, losses: 0 },
    gamesParticipated: 0,
    rank: 1,
    unpickedCount: 0,
    nextLockAt: null,
    ...overrides,
  };
}

function golfResponse(overrides: Partial<GolfCurrentResponse> = {}): GolfCurrentResponse {
  return {
    tournament: {
      id: "t-1",
      name: "FedEx St. Jude Championship",
      startsAt: "2026-08-20T13:00:00.000Z",
      endsAt: "2026-08-23T23:00:00.000Z",
      status: "scheduled",
      locked: false,
    },
    leaderboard: [
      { externalId: "g1", golferName: "Scottie Scheffler", flagUrl: null, position: null },
      { externalId: "g2", golferName: "Sungjae Im", flagUrl: null, position: null },
      { externalId: "g3", golferName: "Ludvig Aberg", flagUrl: null, position: null },
    ],
    myPick: null,
    otherPicks: [{ leagueMemberId: "member-2", displayName: "Bob", hasPicked: false, golferExternalIds: null }],
    golfPickCount: 2,
    golfTopN: 10,
    ...overrides,
  };
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

describe("GolfScreen — picking (tournament not started)", () => {
  it("renders the tournament, the field, and how many golfers to pick", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse());

    await renderRouteAt("/leagues/league-1/golf");

    expect(await screen.findByText("FedEx St. Jude Championship")).toBeInTheDocument();
    expect(screen.getByText(/Pick 2 golfers/)).toBeInTheDocument();
    expect(screen.getByText(/top-10 finish/)).toBeInTheDocument();
    expect(screen.getByText("Scottie Scheffler")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();
  });

  it("shows a golfer's country flag decoratively, and nothing at all when they have none", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(
      golfResponse({
        leaderboard: [
          {
            externalId: "g1",
            golferName: "Scottie Scheffler",
            flagUrl: "https://a.espncdn.com/i/teamlogos/countries/500/usa.png",
            position: 1,
          },
          // No flag — the row must still render, name-only.
          { externalId: "g2", golferName: "Sungjae Im", flagUrl: null, position: 2 },
        ],
      }),
    );

    await renderRouteAt("/leagues/league-1/golf");

    expect(await screen.findByText("Sungjae Im")).toBeInTheDocument();
    const flags = screen.getAllByRole("presentation", { hidden: true });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toHaveAttribute("src", "https://a.espncdn.com/i/teamlogos/countries/500/usa.png");
  });

  it("selecting golfers updates the count and enables saving only at exactly golfPickCount", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse());

    await renderRouteAt("/leagues/league-1/golf");
    await screen.findByText("Scottie Scheffler");

    const save = screen.getByRole("button", { name: "Save picks" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Scottie Scheffler/ }));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Sungjae Im/ }));
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("ignores a tap past the pick limit rather than swapping an existing selection out", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse());

    await renderRouteAt("/leagues/league-1/golf");
    await screen.findByText("Scottie Scheffler");

    fireEvent.click(screen.getByRole("button", { name: /Scottie Scheffler/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sungjae Im/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ludvig Aberg/ })); // one too many

    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scottie Scheffler/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Ludvig Aberg/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("tapping a selected golfer again deselects them", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse());

    await renderRouteAt("/leagues/league-1/golf");
    await screen.findByText("Scottie Scheffler");

    fireEvent.click(screen.getByRole("button", { name: /Scottie Scheffler/ }));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Scottie Scheffler/ }));
    expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();
  });

  it("saving posts the selected golfers for the caller's own membership", async () => {
    await mockShell();
    const { getCurrentGolf, putGolfPick } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse());
    vi.mocked(putGolfPick).mockResolvedValue({
      id: "gp-1",
      leagueMemberId: "member-1",
      tournamentId: "t-1",
      golferExternalIds: ["g1", "g2"],
    });

    await renderRouteAt("/leagues/league-1/golf");
    await screen.findByText("Scottie Scheffler");

    fireEvent.click(screen.getByRole("button", { name: /Scottie Scheffler/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sungjae Im/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save picks" }));

    await waitFor(() => {
      expect(putGolfPick).toHaveBeenCalledWith("league-1", "member-1", "t-1", ["g1", "g2"]);
    });
  });

  it("pre-selects the caller's existing pick from the server", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(golfResponse({ myPick: ["g1", "g3"] }));

    await renderRouteAt("/leagues/league-1/golf");
    await screen.findByText("Scottie Scheffler");

    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scottie Scheffler/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Sungjae Im/ })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("GolfScreen — locked (tournament under way)", () => {
  it("renders a read-only leaderboard with no picker controls once locked", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(
      golfResponse({
        tournament: {
          id: "t-1",
          name: "FedEx St. Jude Championship",
          startsAt: "2026-08-10T13:00:00.000Z",
          endsAt: "2026-08-13T23:00:00.000Z",
          status: "in_progress",
          locked: true,
        },
        leaderboard: [
          { externalId: "g1", golferName: "Scottie Scheffler", flagUrl: null, position: 1 },
          { externalId: "g2", golferName: "Sungjae Im", flagUrl: null, position: 25 },
        ],
        myPick: ["g1"],
      }),
    );

    await renderRouteAt("/leagues/league-1/golf");

    expect(await screen.findByText(/Picks locked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save picks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scottie Scheffler/ })).not.toBeInTheDocument();
    // Inside the top 10 gets the marker; 25th does not.
    expect(screen.getAllByText("Top finish")).toHaveLength(1);
  });
});

describe("GolfScreen — empty and error states", () => {
  it("shows an empty state when no tournament is scheduled", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockResolvedValue(
      golfResponse({ tournament: null, leaderboard: [], otherPicks: [] }),
    );

    await renderRouteAt("/leagues/league-1/golf");

    expect(await screen.findByText("No tournament right now")).toBeInTheDocument();
  });

  it("shows an error state with a retry when the request fails", async () => {
    await mockShell();
    const { getCurrentGolf } = await import("../api/endpoints.js");
    vi.mocked(getCurrentGolf).mockRejectedValue(new Error("boom"));

    await renderRouteAt("/leagues/league-1/golf");

    expect(await screen.findByText("Couldn't load the golf tournament.")).toBeInTheDocument();
  });
});
