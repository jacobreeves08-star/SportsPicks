import { describe, expect, it } from "vitest";
import { teamSelectionStyle } from "./team-selection-style.js";

describe("teamSelectionStyle", () => {
  it("returns null when the color is missing", () => {
    expect(teamSelectionStyle(null)).toBeNull();
    expect(teamSelectionStyle(undefined)).toBeNull();
  });

  it("returns null for a malformed value (not 6 hex digits)", () => {
    expect(teamSelectionStyle("#0e3386")).toBeNull(); // has a leading '#' — wire format never does
    expect(teamSelectionStyle("0e33")).toBeNull();
    expect(teamSelectionStyle("not-a-color")).toBeNull();
  });

  it("picks white text for a dark, saturated team color (Cubs navy)", () => {
    const result = teamSelectionStyle("0e3386");
    expect(result).toEqual({ backgroundColor: "#0e3386", borderColor: "#0e3386", color: "#ffffff" });
  });

  it("picks black text for a light/bright team color", () => {
    const result = teamSelectionStyle("ffd100"); // a bright gold, e.g. Michigan maize
    expect(result?.color).toBe("#000000");
  });

  it("falls back to null for a color too close to the dark page background", () => {
    // Effectively the same near-black as --color-surface — a filled
    // side in this color would look broken (present but invisible),
    // not just plain.
    expect(teamSelectionStyle("0a0a0b")).toBeNull();
    expect(teamSelectionStyle("050505")).toBeNull();
  });
});
