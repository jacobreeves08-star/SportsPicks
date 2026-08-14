import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { createAppRouter } from "../routes/route-tree.js";

/**
 * Shared router-rendering boilerplate for every screen's own test
 * file (auth screens, league create/join screens) — mirrors
 * app-shell/AppShell.test.tsx's own local `renderShellAt` helper (a
 * REAL router + memory history is required for
 * `Link`/`useSearch`/`useRouter` to resolve against the actual
 * registered route tree; a synthetic/standalone test router causes
 * type friction against the globally-registered `AppRouter` type).
 * Not itself a test file — no `describe`/`it`, so Vitest's test glob
 * skips it.
 */
export async function renderRouteAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}
