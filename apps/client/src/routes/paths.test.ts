import { describe, expect, it } from "vitest";
import { joinPath, loginPath, slatePath, standingsPath } from "./paths.js";

describe("path builders", () => {
  it("loginPath omits returnTo entirely when not given", () => {
    expect(loginPath()).toBe("/login");
  });

  it("loginPath encodes returnTo", () => {
    expect(loginPath("/leagues/league-1/slate/2026-08-13")).toBe(
      "/login?returnTo=%2Fleagues%2Fleague-1%2Fslate%2F2026-08-13",
    );
  });

  it("joinPath encodes the invite code", () => {
    expect(joinPath("ABC 123")).toBe("/join/ABC%20123");
  });

  it("slatePath builds the exact required shape", () => {
    expect(slatePath("league-1", "2026-08-13")).toBe("/leagues/league-1/slate/2026-08-13");
  });

  it("standingsPath defaults range to 'today'", () => {
    expect(standingsPath("league-1")).toBe("/leagues/league-1/standings?range=today");
  });

  it("standingsPath accepts an explicit range", () => {
    expect(standingsPath("league-1", "season")).toBe("/leagues/league-1/standings?range=season");
  });
});
