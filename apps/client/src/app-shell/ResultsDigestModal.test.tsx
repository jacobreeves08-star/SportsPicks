import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsDigestResponse } from "../api/types.js";
import { getLastShownDate, resetResultsDigestTrackerForTests, todayLocalDate } from "../notifications/results-digest-tracker.js";
import { ResultsDigestModal } from "./ResultsDigestModal.js";

vi.mock("../api/endpoints.js", () => ({ getResultsDigest: vi.fn() }));

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ResultsDigestModal />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetResultsDigestTrackerForTests();
});

describe("ResultsDigestModal", () => {
  it("fetches on mount and shows the pop-up when there are leagues to report", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 3, losses: 1, gamesParticipated: 4, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    renderModal();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("AFC League")).toBeInTheDocument();
    expect(screen.getByText("3-1")).toBeInTheDocument();
  });

  it("renders nothing when the digest has no leagues, but still marks today as shown", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    vi.mocked(getResultsDigest).mockResolvedValue({ leagues: [] });

    renderModal();

    await waitFor(() => expect(getLastShownDate()).toBe(todayLocalDate()));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not fetch at all when today is already recorded as shown", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 1, losses: 0, gamesParticipated: 1, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    // Simulate: this device already saw today's digest earlier.
    const { markShownToday } = await import("../notifications/results-digest-tracker.js");
    markShownToday(todayLocalDate());

    renderModal();

    // No dialog ever appears, and the endpoint is never even called —
    // not just a fetch whose result gets thrown away.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getResultsDigest).not.toHaveBeenCalled();
  });

  it("dismissing the pop-up hides it", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 1, losses: 0, gamesParticipated: 1, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    renderModal();
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks today as shown as soon as the digest resolves, before the dialog itself renders", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 1, losses: 0, gamesParticipated: 1, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    expect(getLastShownDate()).toBeNull();
    renderModal();

    await screen.findByRole("dialog");
    expect(getLastShownDate()).toBe(todayLocalDate());
  });

  it("has no axe violations", async () => {
    const { getResultsDigest } = await import("../api/endpoints.js");
    const response: ResultsDigestResponse = {
      leagues: [{ leagueId: "league-1", leagueName: "AFC League", date: "2026-08-13", wins: 3, losses: 1, gamesParticipated: 4, rank: 1 }],
    };
    vi.mocked(getResultsDigest).mockResolvedValue(response);

    const { container } = renderModal();
    await screen.findByRole("dialog");

    expect(await axe(container)).toHaveNoViolations();
  });
});
