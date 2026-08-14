import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsDigestEntry } from "../api/types.js";
import { ShareResultsButton } from "./ShareResultsButton.js";

const ENTRIES: ResultsDigestEntry[] = [
  { leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 3, losses: 1, gamesParticipated: 4, rank: 1 },
  { leagueId: "league-2", leagueName: "Friends League", date: "2026-08-13", wins: 2, losses: 2, gamesParticipated: 4, rank: 2 },
];

const originalShare = (navigator as { share?: unknown }).share;

afterEach(() => {
  if (originalShare === undefined) {
    Reflect.deleteProperty(navigator, "share");
  } else {
    Object.defineProperty(navigator, "share", { value: originalShare, configurable: true });
  }
  vi.restoreAllMocks();
});

describe("ShareResultsButton — native share available", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { value: vi.fn().mockResolvedValue(undefined), configurable: true });
  });

  it("renders a single Share button, not the fallback buttons", () => {
    render(<ShareResultsButton entries={ENTRIES} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy text" })).not.toBeInTheDocument();
  });

  it("calls navigator.share with the composed text and the app's own URL", () => {
    render(<ShareResultsButton entries={ENTRIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(navigator.share).toHaveBeenCalledWith({
      title: "Pick'em results",
      text: "Yesterday in Pick'em: 3-1 in AFC League, 2-2 in Friends League 🏈",
      url: window.location.origin,
    });
  });

  it("swallows a user-canceled share (AbortError) without throwing", () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("canceled", "AbortError")),
      configurable: true,
    });
    render(<ShareResultsButton entries={ENTRIES} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Share" }))).not.toThrow();
  });
});

describe("ShareResultsButton — no native share (desktop fallback)", () => {
  beforeEach(() => {
    Reflect.deleteProperty(navigator, "share");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("renders Copy text and Email buttons instead of Share", () => {
    render(<ShareResultsButton entries={ENTRIES} />);
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email" })).toBeInTheDocument();
  });

  it("Copy text writes the composed text plus URL to the clipboard, then confirms", async () => {
    render(<ShareResultsButton entries={ENTRIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `Yesterday in Pick'em: 3-1 in AFC League, 2-2 in Friends League 🏈 ${window.location.origin}`,
    );
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("Email is a mailto: link with the composed text prefilled as the body", () => {
    render(<ShareResultsButton entries={ENTRIES} />);
    const emailLink = screen.getByRole("link", { name: "Email" });
    const href = emailLink.getAttribute("href")!;
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Yesterday in Pick'em: 3-1 in AFC League, 2-2 in Friends League 🏈");
  });
});
