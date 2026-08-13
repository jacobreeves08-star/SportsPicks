import { afterEach, describe, expect, it, vi } from "vitest";
import { startFocusResync } from "./focus-resync.js";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  setVisibility("visible");
});

describe("startFocusResync", () => {
  it("pings when the tab becomes visible", () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const handle = startFocusResync(ping);

    setVisibility("hidden");
    expect(ping).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(ping).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it("does not ping when the tab goes to background", () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const handle = startFocusResync(ping);

    setVisibility("hidden");
    expect(ping).not.toHaveBeenCalled();

    handle.stop();
  });

  it("stops listening after stop() is called", () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const handle = startFocusResync(ping);
    handle.stop();

    setVisibility("hidden");
    setVisibility("visible");
    expect(ping).not.toHaveBeenCalled();
  });

  it("swallows a rejected ping rather than throwing into the caller", async () => {
    const ping = vi.fn().mockRejectedValue(new Error("offline"));
    const handle = startFocusResync(ping);

    expect(() => setVisibility("visible")).not.toThrow();
    // Let the swallowed rejection's microtask settle before finishing.
    await Promise.resolve();

    handle.stop();
  });
});
