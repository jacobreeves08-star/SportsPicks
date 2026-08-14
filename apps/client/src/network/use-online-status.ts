import { useEffect, useState } from "react";

/**
 * The browser's own connectivity signal — genuinely new; the only
 * prior `online`/`offline` listener anywhere in this codebase is
 * `offline/queue.ts`'s internal retry trigger, which isn't exposed as
 * state. Feeds the global banner system's "offline" tone
 * (app-shell/banners/) — never used to gate a pick write itself
 * (`navigator.onLine` is a hint, not proof; the offline queue's own
 * network-failure handling is what actually decides that).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
