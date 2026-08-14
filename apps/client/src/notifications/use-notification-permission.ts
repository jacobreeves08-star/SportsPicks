import { useCallback, useState } from "react";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

function currentPermission(): NotificationPermissionState {
  return typeof Notification === "undefined" ? "unsupported" : (Notification.permission as NotificationPermissionState);
}

/**
 * A thin wrapper over the browser's own `Notification` permission
 * API. Ground-laying infra, deliberately NOT wired to any push
 * subscription or backend token endpoint — this repo has no push
 * delivery mechanism at all yet (docs/notifications.md: email only).
 * Capturing consent now, while the moment (right after a completed
 * slate) is genuinely right, is still worth doing — see
 * `docs/app-shell.md` for the full reasoning and what this is
 * deliberately NOT connected to yet.
 */
export function useNotificationPermission() {
  const [state, setState] = useState<NotificationPermissionState>(currentPermission);

  const request = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof Notification === "undefined") return "unsupported";
    const result = (await Notification.requestPermission()) as NotificationPermissionState;
    setState(result);
    return result;
  }, []);

  return { state, request };
}
