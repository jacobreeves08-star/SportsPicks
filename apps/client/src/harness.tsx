import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LockTransitionHarness } from "./e2e-harness/lock-transition-harness.js";
import { QueryProvider } from "./query/query-provider.js";

/**
 * Entry point for harness.html ONLY — see
 * e2e-harness/lock-transition-harness.tsx's own doc comment for why
 * this exists and why it's deliberately separate from main.tsx/the
 * real app. Not reachable from the product route tree.
 */
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("harness.tsx: #root element not found in harness.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryProvider>
      <LockTransitionHarness />
    </QueryProvider>
  </StrictMode>,
);
