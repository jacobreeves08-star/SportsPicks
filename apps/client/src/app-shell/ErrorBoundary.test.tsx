import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

vi.mock("../observability/error-tracking.js", () => ({ captureException: vi.fn() }));

function Bomb(): never {
  throw new Error("boom");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("catches a thrown error and renders ErrorState instead of crashing the tree", () => {
    // React logs the caught error to the console in dev — expected
    // noise, silenced here so the test's real output isn't buried.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong. Try reloading.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("reports the caught error to error tracking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { captureException } = await import("../observability/error-tracking.js");

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("retry reloads the page rather than just clearing local state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // jsdom's `window.location` isn't a plain object — `reload` isn't
    // configurable enough for `vi.spyOn` directly. Replacing the whole
    // `location` property (the standard workaround for this exact
    // jsdom limitation) is what actually lets the click handler's
    // real `window.location.reload()` call be observed.
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
