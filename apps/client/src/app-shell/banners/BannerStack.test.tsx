import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { GlobalBanner } from "./GlobalBanner.types.js";
import { BannerStack } from "./BannerStack.js";

const mockUseGlobalBanners = vi.hoisted(() => vi.fn<() => GlobalBanner | null>());
vi.mock("./use-global-banners.js", () => ({ useGlobalBanners: mockUseGlobalBanners }));

describe("BannerStack", () => {
  it("renders nothing when there's no banner", () => {
    mockUseGlobalBanners.mockReturnValue(null);
    const { container } = render(<BannerStack />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the offline banner", () => {
    mockUseGlobalBanners.mockReturnValue({ kind: "offline" });
    render(<BannerStack />);
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it("renders the degraded banner", () => {
    mockUseGlobalBanners.mockReturnValue({ kind: "degraded" });
    render(<BannerStack />);
    expect(screen.getByText(/trouble reaching the server/i)).toBeInTheDocument();
  });

  it("renders the reconnecting banner", () => {
    mockUseGlobalBanners.mockReturnValue({ kind: "reconnecting" });
    render(<BannerStack />);
    expect(screen.getByText(/sending your queued picks/i)).toBeInTheDocument();
  });

  it("renders the unsaved-picks banner with correct singular/plural wording", () => {
    mockUseGlobalBanners.mockReturnValue({ kind: "unsaved-picks", count: 1 });
    const { rerender } = render(<BannerStack />);
    expect(screen.getByText("1 pick hasn't saved yet.")).toBeInTheDocument();

    mockUseGlobalBanners.mockReturnValue({ kind: "unsaved-picks", count: 3 });
    rerender(<BannerStack />);
    expect(screen.getByText("3 picks haven't saved yet.")).toBeInTheDocument();
  });

  it("renders StaleBanner (design-system) for the stale kind, passing asOf/reason through", () => {
    mockUseGlobalBanners.mockReturnValue({ kind: "stale", asOf: "2026-08-13T18:00:00.000Z", reason: "sports feed degraded" });
    render(<BannerStack />);
    expect(screen.getByText(/sports feed degraded/)).toBeInTheDocument();
  });

  it("has no axe violations for any banner kind", async () => {
    const kinds: GlobalBanner[] = [
      { kind: "offline" },
      { kind: "degraded" },
      { kind: "reconnecting" },
      { kind: "unsaved-picks", count: 2 },
      { kind: "stale", asOf: "2026-08-13T18:00:00.000Z" },
    ];
    for (const banner of kinds) {
      mockUseGlobalBanners.mockReturnValue(banner);
      const { container, unmount } = render(<BannerStack />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
