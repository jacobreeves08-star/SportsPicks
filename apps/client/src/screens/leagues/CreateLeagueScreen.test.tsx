import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { CreatedLeague, OpsSummary, UserProfile } from "../../api/types.js";
import { resetCurrentLeagueForTests } from "../../leagues/current-league-store.js";
import { renderRouteAt } from "../render-route.js";

// CreateLeagueScreen sits under authenticatedLayoutRoute, so it mounts
// the real AppShell — same mock set as LoginScreen.test.tsx's
// mockAppShellDependencies, plus createLeague/getSlate for this
// screen's own submit -> continue flow.
vi.mock("../../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  createLeague: vi.fn(),
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

async function mockShell() {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
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

describe("CreateLeagueScreen", () => {
  it("defaults the timezone to the caller's own profile timezone", async () => {
    await mockShell();
    await renderRouteAt("/leagues/new");

    expect(await screen.findByLabelText("Timezone")).toHaveValue("America/Chicago");
  });

  it("blocks submission locally when nothing is filled in", async () => {
    await mockShell();
    const { createLeague } = await import("../../api/endpoints.js");

    await renderRouteAt("/leagues/new");
    fireEvent.click(await screen.findByRole("button", { name: "Create league" }));

    expect(await screen.findByText("Pick at least one sport.")).toBeInTheDocument();
    expect(createLeague).not.toHaveBeenCalled();
  });

  it("submits with the selected sports, name, season start, and timezone", async () => {
    await mockShell();
    const { createLeague } = await import("../../api/endpoints.js");
    vi.mocked(createLeague).mockResolvedValue({
      id: "league-1",
      name: "AFC League",
      sports: ["nfl", "nba"],
      commissionerId: "user-1",
      timezone: "America/Chicago",
      seasonStart: "2026-09-01",
      pickHorizonDays: 7,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      memberCount: 1,
      inviteCode: "ABC12345",
    } satisfies CreatedLeague);

    await renderRouteAt("/leagues/new");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "AFC League" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "NFL" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "NBA" }));
    fireEvent.change(screen.getByLabelText("Season start"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));

    await waitFor(() =>
      expect(createLeague).toHaveBeenCalledWith({
        name: "AFC League",
        sports: ["nfl", "nba"],
        timezone: "America/Chicago",
        seasonStart: "2026-09-01",
        pickHorizonDays: 7,
      }),
    );
    expect(await screen.findByText("ABC12345")).toBeInTheDocument();
  });

  it("continuing after creation navigates to the new league's slate", async () => {
    await mockShell();
    const { createLeague, getSlate } = await import("../../api/endpoints.js");
    vi.mocked(createLeague).mockResolvedValue({
      id: "league-1",
      name: "AFC League",
      sports: ["nfl"],
      commissionerId: "user-1",
      timezone: "America/Chicago",
      seasonStart: "2026-09-01",
      pickHorizonDays: 7,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      memberCount: 1,
      inviteCode: "ABC12345",
    } satisfies CreatedLeague);
    vi.mocked(getSlate).mockResolvedValue({ date: "2026-08-13", games: [], pickedCount: 0, totalCount: 0 });

    const router = await renderRouteAt("/leagues/new");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "AFC League" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "NFL" }));
    fireEvent.change(screen.getByLabelText("Season start"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/leagues/league-1/slate/2026-08-13"));
  });

  it("maps a VALIDATION_ERROR field onto the right input", async () => {
    await mockShell();
    const { createLeague } = await import("../../api/endpoints.js");
    vi.mocked(createLeague).mockRejectedValue(
      new ApiError(
        {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          fields: [{ field: "sports", message: "unknown sport code: xyz" }],
        },
        400,
      ),
    );

    await renderRouteAt("/leagues/new");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "AFC League" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "NFL" }));
    fireEvent.change(screen.getByLabelText("Season start"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));

    expect(await screen.findByText("unknown sport code: xyz")).toBeInTheDocument();
  });

  it(
    "has no axe violations",
    async () => {
      // Longer timeout: the timezone <select> renders ~400 <option>
      // elements (a real IANA zone list, same as SignupScreen's),
      // and axe-core's scan takes noticeably longer over that much
      // DOM than Vitest's 5s default.
      await mockShell();
      await renderRouteAt("/leagues/new");
      await waitFor(() => screen.getByLabelText("Name"));
      expect(await axe(document.body)).toHaveNoViolations();
    },
    15000,
  );
});
