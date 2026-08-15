import { screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "../api/auth-store.js";
import type { LeagueHomeEntry, OpsSummary, UserProfile } from "../api/types.js";
import { resetCurrentLeagueForTests } from "../leagues/current-league-store.js";
import { renderRouteAt } from "./render-route.js";

vi.mock("../api/endpoints.js", () => ({
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
  getSlate: vi.fn(),
  getDailyTrivia: vi.fn(),
  answerDailyTrivia: vi.fn(),
  getTriviaStats: vi.fn(),
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

const LEAGUE: LeagueHomeEntry = {
  id: "league-1",
  name: "AFC League",
  sports: ["nfl"],
  memberCount: 4,
  leagueMemberId: "member-1",
  record: { wins: 3, losses: 1 },
  gamesParticipated: 4,
  rank: 2,
  unpickedCount: 0,
  nextLockAt: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  resetCurrentLeagueForTests();
  localStorage.clear();

  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getMyLeagues).mockResolvedValue([LEAGUE]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
});

describe("`/` for a logged-out visitor", () => {
  it("renders the public landing page instead of redirecting to /login", async () => {
    // This is the behavior change the college-quiz feature required:
    // `/` used to be auth-guarded, so a stranger's first impression of
    // this app was a password field.
    const router = await renderRouteAt("/");

    expect(router.state.location.pathname).toBe("/");
    expect(await screen.findByRole("heading", { name: /pick your winners/i })).toBeInTheDocument();
  });

  it("offers the quiz as the hero's primary action, with no account required", async () => {
    await renderRouteAt("/");
    await screen.findByRole("heading", { name: /pick your winners/i });

    const hero = document.querySelector<HTMLElement>('section[aria-labelledby="hero-title"]');
    expect(hero).not.toBeNull();
    const play = within(hero as HTMLElement).getByRole("link", { name: /play now/i });
    expect(play).toHaveAttribute("href", "/college-quiz");
    expect(within(hero as HTMLElement).getByText(/no account needed/i)).toBeInTheDocument();
  });

  it("still offers log in and sign up", async () => {
    await renderRouteAt("/");

    // Both live in the marketing header now rather than a button row
    // under the quiz card — this page's hero card is the quiz, and the
    // account actions are chrome that follows the visitor down the
    // whole page instead of scrolling away.
    expect(await screen.findByRole("link", { name: /^log in$/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /^sign up free$/i })).toHaveAttribute("href", "/signup");
  });

  it("renders the same marketing site /login does, not a second design", async () => {
    // The regression this test exists for actually shipped: the
    // marketing redesign landed on /login only, so a visitor typing
    // the bare domain got a completely different-looking product.
    // Both pages now compose the same MarketingSections, and these
    // ids are the cheapest proof that neither has quietly forked.
    await renderRouteAt("/");
    await screen.findByRole("heading", { name: /pick your winners/i });

    for (const id of ["how-it-works", "sports", "features", "faq"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.querySelector("header")).not.toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
  });

  it("has no dead in-page anchors — every '#' link has a target here", async () => {
    // The chrome is shared with /login, which HAS a #login card; this
    // page doesn't, so anything hard-coded to jump to one would be a
    // link that silently does nothing.
    await renderRouteAt("/");
    await screen.findByRole("heading", { name: /pick your winners/i });

    const hashLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    expect(hashLinks.length).toBeGreaterThan(0);
    for (const link of hashLinks) {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();
    }
  });

  it("never calls an authenticated endpoint — a logged-out visitor has no session to use", async () => {
    const { getMyLeagues, getMe } = await import("../api/endpoints.js");
    await renderRouteAt("/");
    await screen.findByRole("heading", { name: /pick your winners/i });

    expect(getMyLeagues).not.toHaveBeenCalled();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/");
    await screen.findByRole("heading", { name: /pick your winners/i });

    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe("`/` for a logged-in visitor", () => {
  beforeEach(() => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
  });

  it("renders the leagues home, not the public landing", async () => {
    await renderRouteAt("/");

    expect(await screen.findByRole("link", { name: /AFC League/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /play today.s quiz/i })).not.toBeInTheDocument();
  });

  it("shows the quiz trigger on the leagues home — the post-login entry point", async () => {
    await renderRouteAt("/");
    await screen.findByRole("link", { name: /AFC League/ });

    expect(screen.getByText(/today.s college quiz/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^play$/i })).toHaveAttribute("href", "/college-quiz");
  });

  it("offers the quiz even with zero leagues — it needs no league at all", async () => {
    const { getMyLeagues } = await import("../api/endpoints.js");
    vi.mocked(getMyLeagues).mockResolvedValue([]);

    await renderRouteAt("/");

    expect(await screen.findByText(/no leagues yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^play$/i })).toHaveAttribute("href", "/college-quiz");
  });

  it("keeps the app shell chrome around it", async () => {
    await renderRouteAt("/");
    await screen.findByRole("link", { name: /AFC League/ });

    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
  });
});
