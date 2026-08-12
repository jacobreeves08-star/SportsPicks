import { describe, expect, it } from "vitest";
import { containsDisallowedContent } from "./content-filter.js";

describe("containsDisallowedContent", () => {
  it("flags a blocklisted word", () => {
    expect(containsDisallowedContent("This league is shit")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(containsDisallowedContent("SHIT League")).toBe(true);
  });

  it("matches on word boundaries, not substrings", () => {
    // "assholeville" contains "asshole" as a substring but isn't the
    // word itself — a word-boundary filter shouldn't flag it; a naive
    // substring filter would (and would also wrongly flag innocuous
    // words like "classic" for containing "ass" if the list held "ass").
    expect(containsDisallowedContent("Assholeville Fantasy League")).toBe(false);
  });

  it("passes an ordinary league name", () => {
    expect(containsDisallowedContent("Sunday Ballers")).toBe(false);
  });
});
