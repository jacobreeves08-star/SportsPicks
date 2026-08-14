import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/browser", () => sentryMock);

// A plain mutable object, not a per-test re-mock: `error-tracking.ts`
// imports `SENTRY_DSN` as a named binding, which under ESM live-
// binding semantics reflects THIS object's current property value at
// each read (every export/captureX call reads it fresh) — so tests
// can just mutate `configMock.SENTRY_DSN` instead of juggling
// vi.doMock/vi.resetModules/dynamic re-import per test.
const configMock = vi.hoisted(() => ({ SENTRY_DSN: undefined as string | undefined }));
vi.mock("../api/config.js", () => configMock);

import { captureException, captureMessage, initErrorTracking } from "./error-tracking.js";

beforeEach(() => {
  vi.clearAllMocks();
  configMock.SENTRY_DSN = undefined;
});

describe("error-tracking — no DSN configured (the default, e.g. local dev/CI)", () => {
  it("every export is a safe no-op, never throws, never touches Sentry", () => {
    expect(() => initErrorTracking()).not.toThrow();
    expect(() => captureException(new Error("boom"))).not.toThrow();
    expect(() => captureMessage("something looks off", { foo: "bar" })).not.toThrow();

    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });
});

describe("error-tracking — a DSN is configured", () => {
  beforeEach(() => {
    configMock.SENTRY_DSN = "https://example@sentry.example/1";
  });

  it("initializes Sentry with the configured DSN", () => {
    initErrorTracking();
    expect(sentryMock.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://example@sentry.example/1" }));
  });

  it("forwards exceptions to Sentry", () => {
    const error = new Error("boom");
    captureException(error);
    expect(sentryMock.captureException).toHaveBeenCalledWith(error);
  });

  it("forwards messages to Sentry with the warning level and extra context", () => {
    captureMessage("something looks off", { foo: "bar" });
    expect(sentryMock.captureMessage).toHaveBeenCalledWith("something looks off", {
      level: "warning",
      extra: { foo: "bar" },
    });
  });
});
