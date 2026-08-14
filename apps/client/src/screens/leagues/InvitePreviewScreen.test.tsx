import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { InvitePreview, JoinedLeague } from "../../api/types.js";
import { resetCurrentLeagueForTests } from "../../leagues/current-league-store.js";
import { renderRouteAt } from "../render-route.js";

vi.mock("../../api/endpoints.js", () => ({
  previewInvite: vi.fn(),
  joinLeague: vi.fn(),
  getSlate: vi.fn(),
}));

function preview(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return { name: "AFC League", sports: ["nfl", "nba"], memberCount: 4, alreadyMember: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
});

describe("InvitePreviewScreen", () => {
  it("shows the league name, sport labels, and member count", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview());

    await renderRouteAt("/join/ABC123");

    expect(await screen.findByRole("heading", { name: "AFC League" })).toBeInTheDocument();
    expect(screen.getByText("NFL, NBA · 4 members")).toBeInTheDocument();
    expect(previewInvite).toHaveBeenCalledWith("ABC123");
  });

  it("shows an error for an invalid code, with no join UI", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockRejectedValue(new ApiError({ code: "INVITE_CODE_NOT_FOUND", message: "Invalid invite code" }, 404));

    await renderRouteAt("/join/BADCODE");

    expect(await screen.findByText("Invalid invite code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });

  it("tells an already-active member they're already in, with no join button", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview({ alreadyMember: true }));
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });

    await renderRouteAt("/join/ABC123");

    expect(await screen.findByText("You're already a member of this league.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });

  it("offers signup/login (not a join button) to a logged-out visitor, both carrying returnTo back to this exact URL", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview());

    await renderRouteAt("/join/ABC123");

    expect(await screen.findByRole("link", { name: "Sign up to join" })).toHaveAttribute(
      "href",
      "/signup?returnTo=%2Fjoin%2FABC123",
    );
    expect(screen.getByRole("link", { name: "Log in to join" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fjoin%2FABC123",
    );
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });

  it("an authenticated, not-yet-member visitor can join, then lands on that league's slate", async () => {
    const { previewInvite, joinLeague, getSlate } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview());
    vi.mocked(joinLeague).mockResolvedValue({ leagueId: "league-1", leagueName: "AFC League" } satisfies JoinedLeague);
    vi.mocked(getSlate).mockResolvedValue({ date: "2026-08-13", games: [], pickedCount: 0, totalCount: 0 });
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });

    const router = await renderRouteAt("/join/ABC123");
    fireEvent.click(await screen.findByRole("button", { name: "Join this league" }));

    await waitFor(() => expect(joinLeague).toHaveBeenCalledWith("ABC123"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/leagues/league-1/slate/2026-08-13"));
  });

  it("shows the server's own message when joining fails", async () => {
    const { previewInvite, joinLeague } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview());
    vi.mocked(joinLeague).mockRejectedValue(new ApiError({ code: "LEAGUE_FULL", message: "This league is at capacity" }, 409));
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });

    await renderRouteAt("/join/ABC123");
    fireEvent.click(await screen.findByRole("button", { name: "Join this league" }));

    expect(await screen.findByText("This league is at capacity")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { previewInvite } = await import("../../api/endpoints.js");
    vi.mocked(previewInvite).mockResolvedValue(preview());

    await renderRouteAt("/join/ABC123");
    await screen.findByRole("heading", { name: "AFC League" });
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
