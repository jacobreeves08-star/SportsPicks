import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { setAuthTokens } from "../api/auth-store.js";
import { createAppRouter } from "./route-tree.js";
import { navigateAfterLogin, safeReturnTo } from "./post-login-redirect.js";

describe("safeReturnTo", () => {
  it("accepts a same-app relative path", () => {
    expect(safeReturnTo("/leagues/league-1/slate/2026-08-13")).toBe("/leagues/league-1/slate/2026-08-13");
  });

  it("accepts a relative path with a query string", () => {
    expect(safeReturnTo("/leagues/league-1/standings?range=week")).toBe("/leagues/league-1/standings?range=week");
  });

  it("falls back to home for undefined", () => {
    expect(safeReturnTo(undefined)).toBe("/");
  });

  it("falls back to home for an empty string", () => {
    expect(safeReturnTo("")).toBe("/");
  });

  it("rejects an absolute URL — the open-redirect case", () => {
    expect(safeReturnTo("https://evil.example.com/phish")).toBe("/");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeReturnTo("//evil.example.com/phish")).toBe("/");
  });

  it("rejects a path that doesn't start with a slash at all", () => {
    expect(safeReturnTo("leagues/league-1")).toBe("/");
  });
});

describe("navigateAfterLogin", () => {
  it("navigates to a validated returnTo", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    await router.load();

    await navigateAfterLogin(router, "/leagues/league-1/standings?range=week");

    expect(router.state.location.pathname).toBe("/leagues/league-1/standings");
  });

  it("navigates home when returnTo is an open-redirect attempt", async () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/login"] }));
    await router.load();
    const navigateSpy = vi.spyOn(router, "navigate");

    await navigateAfterLogin(router, "//evil.example.com");

    expect(navigateSpy).toHaveBeenCalledWith({ to: "/" });
  });
});
