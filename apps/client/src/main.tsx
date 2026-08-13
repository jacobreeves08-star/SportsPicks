import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Entry point for infrastructure verification only — Epics 9-11 build
 * the real screens. Wired up incrementally as this epic's modules
 * land (the query client + provider in query/, the router in
 * routes/), each replacing this file's contents as it becomes
 * available, so every commit in this epic stays in a runnable state
 * rather than referencing pieces that don't exist yet.
 */
function InfrastructureStatus() {
  return (
    <main>
      <h1>Sports Pick&apos;em — client infrastructure</h1>
      <p>No screens exist yet. This page exists so the modules under src/ can be exercised in a real browser.</p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <InfrastructureStatus />
  </StrictMode>,
);
