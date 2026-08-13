import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setAuthTokens } from "./auth-store.js";
import { resetClockSyncForTests } from "../time/server-clock.js";
import { getMembers, getMyLeagues, getSlate, signup, writePick } from "./endpoints.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-server-time": "2026-08-13T12:00:00.000Z" },
  });
}

beforeEach(() => {
  resetAuthStoreForTests();
  resetClockSyncForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("endpoints — representative coverage of the typed wrappers", () => {
  it("signup posts without an Authorization header, per the contract (runs before a session exists)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { message: "Check your email to verify your account." }));
    vi.stubGlobal("fetch", fetchMock);

    await signup({ email: "a@example.com", password: "password123", displayName: "A", timezone: "UTC" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/auth/signup");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toMatchObject({ email: "a@example.com" });
  });

  it("getMyLeagues issues a plain authenticated GET and returns the bare array", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: "league-1", name: "Test" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMyLeagues();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/leagues");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at");
    expect(result).toEqual([{ id: "league-1", name: "Test" }]);
  });

  it("writePick PUTs to the per-member per-game path with the selectedTeam body", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { id: "pick-1", leagueMemberId: "member-1", gameId: "game-1", selectedTeam: "Bills", createdAt: "2026-08-13T12:00:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writePick("league-1", "member-1", "game-1", "Bills");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/leagues/league-1/members/member-1/picks/game-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ selectedTeam: "Bills" });
  });

  it("getSlate omits the date query param entirely when not provided (server defaults to today in league tz)", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    // A fresh Response per call — a Response's body stream can only be
    // read once, so a shared `mockResolvedValue` (same instance
    // reused) breaks on the SECOND call in a test that calls the
    // mocked fetch more than once.
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, { date: "2026-08-13", games: [], pickedCount: 0, totalCount: 0 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getSlate("league-1");
    let [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url).searchParams.has("date")).toBe(false);

    await getSlate("league-1", "2026-08-14");
    [url] = fetchMock.mock.calls[1]!;
    expect(new URL(url).searchParams.get("date")).toBe("2026-08-14");
  });

  it("getMembers forwards pagination params as query params", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [], pagination: { next_cursor: null, limit: 10 } }));
    vi.stubGlobal("fetch", fetchMock);

    await getMembers("league-1", { limit: 10, cursor: "abc" });

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/leagues/league-1/members");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("cursor")).toBe("abc");
  });
});
