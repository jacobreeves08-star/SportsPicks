import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "./query-client.js";

/**
 * Wraps the app in exactly one `QueryClient` instance for the
 * component tree's lifetime — `useState`'s lazy initializer (not a
 * bare `createQueryClient()` call in the render body) is what
 * guarantees the client is created once, not recreated (and its whole
 * cache lost) on every re-render of whatever mounts this.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
