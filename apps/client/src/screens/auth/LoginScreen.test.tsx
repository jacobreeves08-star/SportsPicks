import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests } from "../../api/auth-store.js";
import { ApiError } from "../../api/errors.js";
import type { OpsSummary, UserProfile } from "../../api/types.js";
import { SPORT_OPTIONS } from "../../leagues/sports.js";
import { renderRouteAt } from "../render-route.js";

// LoginScreen navigates to a PROTECTED route on success, which mounts
// the real AppShell (authenticatedLayoutRoute's component) — so this
// file mocks the same endpoints AppShell.test.tsx does, not just
// `login`. `getMe` is needed too: the returnTo redirect test below
// lands on /profile, which mounts ProfileScreen -> PreferencesForm ->
// useMe() -> getMe() — an unmocked call there throws just as surely
// as an unmocked getMyLeagues() would.
vi.mock("../../api/endpoints.js", () => ({
  login: vi.fn(),
  getMe: vi.fn(),
  getMyLeagues: vi.fn(),
  getDataFreshness: vi.fn(),
  pingHealth: vi.fn(),
}));

const PROFILE: UserProfile = {
  id: "user-1",
  email: "a@example.com",
  displayName: "Test",
  timezone: "UTC",
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

async function mockAppShellDependencies() {
  const { getMe, getMyLeagues, getDataFreshness, pingHealth } = await import("../../api/endpoints.js");
  vi.mocked(getMe).mockResolvedValue(PROFILE);
  vi.mocked(getMyLeagues).mockResolvedValue([]);
  vi.mocked(getDataFreshness).mockResolvedValue(HEALTHY_SUMMARY);
  vi.mocked(pingHealth).mockResolvedValue({ status: "ok" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthStoreForTests();
  localStorage.clear();
});

describe("LoginScreen", () => {
  it("on success, stores the tokens and navigates home when there's no returnTo", async () => {
    const { login } = await import("../../api/endpoints.js");
    await mockAppShellDependencies();
    vi.mocked(login).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      accessTokenExpiresAt: "2026-08-13T19:00:00.000Z",
      refreshTokenExpiresAt: "2026-11-11T18:00:00.000Z",
    });

    const router = await renderRouteAt("/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("on success, navigates to the exact preserved returnTo path", async () => {
    const { login } = await import("../../api/endpoints.js");
    await mockAppShellDependencies();
    vi.mocked(login).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      accessTokenExpiresAt: "2026-08-13T19:00:00.000Z",
      refreshTokenExpiresAt: "2026-11-11T18:00:00.000Z",
    });

    const router = await renderRouteAt("/login?returnTo=%2Fprofile");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
  });

  it("shows the server's own message on invalid credentials, without navigating", async () => {
    const { login } = await import("../../api/endpoints.js");
    vi.mocked(login).mockRejectedValue(new ApiError({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }, 401));

    const router = await renderRouteAt("/login");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("links to signup and password reset", async () => {
    await renderRouteAt("/login");
    expect(await screen.findByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/password-reset");
  });

  it("has no axe violations", async () => {
    await renderRouteAt("/login");
    await waitFor(() => screen.getByLabelText("Email"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

/**
 * `/login` is a full marketing landing page, not just a form — these
 * cover the parts of that page a change could silently break without
 * failing anything above: the login form staying reachable, the copy
 * matching what the app can actually do, and `?returnTo=` surviving
 * every route link the marketing chrome added.
 */
describe("LoginScreen as the marketing landing page", () => {
  it("makes the hero headline the page's only h1, with the form under an h2", async () => {
    await renderRouteAt("/login");

    const h1s = await screen.findAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/pick your winners/i);
    expect(screen.getByRole("heading", { level: 2, name: "Log in" })).toBeInTheDocument();
  });

  it("keeps the login form on the page itself, not a click away", async () => {
    await renderRouteAt("/login");

    // The marketing sections must never push the form onto another
    // route — a returning user's whole reason for being here.
    const card = document.getElementById("login");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByLabelText("Email")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("gives every in-page nav link a real target on this page", async () => {
    await renderRouteAt("/login");
    await screen.findAllByRole("heading", { level: 1 });

    // A dead "#features" link is invisible in review and obvious to a
    // visitor, so assert the contract rather than eyeballing it.
    const hashLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    expect(hashLinks.length).toBeGreaterThan(0);
    for (const link of hashLinks) {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();
    }
  });

  it("advertises exactly the sports a league can actually be created with", async () => {
    await renderRouteAt("/login");
    await screen.findAllByRole("heading", { level: 1 });

    // The grid renders SPORT_OPTIONS directly, so this fails loudly if
    // the page ever grows a hand-typed sport list that drifts from the
    // server-validated one.
    for (const sport of SPORT_OPTIONS) {
      expect(screen.getByText(sport.label)).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: new RegExp(`${SPORT_OPTIONS.length} sports`, "i") })).toBeInTheDocument();
  });

  it("puts the no-account quiz in the hero, not only in a section far down the page", async () => {
    await renderRouteAt("/login");
    await screen.findAllByRole("heading", { level: 1 });

    // The quiz is the only thing here a visitor with no account can
    // do, so it has to be reachable without scrolling. jsdom does no
    // layout, so "above the fold" isn't directly assertable — but
    // "inside the hero" is the structural fact that makes it true, and
    // it's the part a later edit could silently undo.
    const hero = document.querySelector<HTMLElement>('section[aria-labelledby="hero-title"]');
    expect(hero).not.toBeNull();
    expect(within(hero as HTMLElement).getByRole("link", { name: /play now/i })).toHaveAttribute(
      "href",
      "/college-quiz",
    );
    expect(within(hero as HTMLElement).getByText(/no account needed/i)).toBeInTheDocument();
  });

  it("keeps the fuller quiz pitch further down too, pointing at the same place", async () => {
    await renderRouteAt("/login");

    expect(await screen.findByRole("link", { name: /play today.s quiz/i })).toHaveAttribute("href", "/college-quiz");
  });

  it("carries returnTo through EVERY signup link, not just the one in the form", async () => {
    // The session-expiry contract has to survive the marketing chrome:
    // signing up from the header or the closing CTA must land the
    // visitor back where they were, exactly like the card's link does.
    await renderRouteAt("/login?returnTo=%2Fprofile");
    await screen.findAllByRole("heading", { level: 1 });

    const signupLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/signup"]'));
    expect(signupLinks.length).toBeGreaterThan(1);
    for (const link of signupLinks) {
      expect(link).toHaveAttribute("href", "/signup?returnTo=%2Fprofile");
    }
  });
});
