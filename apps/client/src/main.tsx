import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./app-shell/ErrorBoundary.js";
import "./design-system/tokens/tokens.css";
import "./design-system/base.css";
import { initErrorTracking } from "./observability/error-tracking.js";
import { QueryProvider } from "./query/query-provider.js";
import { createAppRouter } from "./routes/route-tree.js";
import { startSessionExpiryRedirect } from "./routes/session-redirect.js";

/**
 * The app's entry point. Epic 10 is the first epic to render real
 * content here — auth-gated routing, the persistent shell (nav +
 * banners), and now the placeholder screens routed inside it (Epic 11
 * replaces those with the real pick-flow/standings/profile UI).
 *
 * `initErrorTracking()` runs FIRST, before anything else — same "as
 * early as possible" placement as the server's own `initErrorTracking()`
 * at the top of `server.ts` — so a crash during router/query-client
 * construction itself would still have a chance of being reported.
 * `ErrorBoundary` wraps the whole `RouterProvider`, not just the
 * authenticated shell, so a crash on `/login` can't white-screen the
 * app either.
 */
initErrorTracking();

const router = createAppRouter();
startSessionExpiryRedirect(router);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <RouterProvider router={router} />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>,
);
