import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryProvider } from "./query/query-provider.js";
import { createAppRouter } from "./routes/route-tree.js";
import { startSessionExpiryRedirect } from "./routes/session-redirect.js";

/**
 * Entry point for infrastructure verification only — Epics 9-11 build
 * the real screens (routes/route-tree.tsx's leaf routes have no
 * `component` yet). Every module this epic built is wired together
 * here: the query client (Step 5), the router and its deep links
 * (Step 8), and the session-expiry redirect connecting Step 2's
 * auth-store event to Step 8's router.
 */
const router = createAppRouter();
startSessionExpiryRedirect(router);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  </StrictMode>,
);
