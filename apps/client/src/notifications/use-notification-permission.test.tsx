import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotificationPermission } from "./use-notification-permission.js";

const originalNotification = (globalThis as { Notification?: unknown }).Notification;

function installFakeNotification(initialPermission: NotificationPermission, requestResult: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue(requestResult);
  (globalThis as { Notification?: unknown }).Notification = {
    permission: initialPermission,
    requestPermission,
  };
  return { requestPermission };
}

afterEach(() => {
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
  vi.restoreAllMocks();
});

describe("useNotificationPermission", () => {
  it("reports 'unsupported' when the browser has no Notification API at all", () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    const { result } = renderHook(() => useNotificationPermission());
    expect(result.current.state).toBe("unsupported");
  });

  it("reflects the browser's current permission on mount", () => {
    installFakeNotification("default", "granted");
    const { result } = renderHook(() => useNotificationPermission());
    expect(result.current.state).toBe("default");
  });

  it("request() calls the real browser API and updates state to the result", async () => {
    const { requestPermission } = installFakeNotification("default", "granted");
    const { result } = renderHook(() => useNotificationPermission());

    await act(async () => {
      await result.current.request();
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.state).toBe("granted"));
  });

  it("request() reflects a denial too — denied is real and (per the brief) hard to recover from", async () => {
    installFakeNotification("default", "denied");
    const { result } = renderHook(() => useNotificationPermission());

    await act(async () => {
      await result.current.request();
    });

    expect(result.current.state).toBe("denied");
  });

  it("request() on an unsupported browser resolves 'unsupported' without throwing", async () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    const { result } = renderHook(() => useNotificationPermission());

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.request();
    });

    expect(outcome).toBe("unsupported");
  });
});
