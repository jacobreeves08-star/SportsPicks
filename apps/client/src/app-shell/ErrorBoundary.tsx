import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { ErrorState } from "../design-system/index.js";
import { captureException } from "../observability/error-tracking.js";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A crash on one screen must not white-screen the app (Epic 10
 * brief). Still a class component under React 18.3.1 — no hook
 * equivalent for `componentDidCatch`/`getDerivedStateFromError`
 * exists at this version. Mounted at the root (`main.tsx`), wrapping
 * the whole router — a crash on `/login` shouldn't white-screen
 * either, so this deliberately sits OUTSIDE `authenticatedLayoutRoute`'s
 * shell chrome, not inside it.
 *
 * Retry means a full `window.location.reload()`, not just clearing
 * local state — a caught render-tree error is definitionally an
 * unknown state, and this app's offline-queue write path
 * (offline/queue.ts) shouldn't risk running against whatever's left
 * of it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureException(error);
    if (import.meta.env.DEV) {
      // Dev-only diagnostic — captureException above is the real
      // reporting path; no-console isn't enabled in this config, but
      // scoping to DEV keeps this out of a production console anyway.
      console.error("ErrorBoundary caught:", error, info.componentStack);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          message="Something went wrong. Try reloading."
          onRetry={() => {
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}
