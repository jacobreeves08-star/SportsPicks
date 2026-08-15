import { MaybeShell } from "../app-shell/MaybeShell.js";
import { useIsAuthenticated } from "../api/use-auth-state.js";
import { HomeScreen } from "./HomeScreen.js";
import { PublicHomeScreen } from "./PublicHomeScreen.js";

/**
 * `/` — the one route in this app that is genuinely both public and
 * authenticated, so the branch lives here in a component rather than
 * in a `beforeLoad` redirect.
 *
 * It used to be neither: `/` was auth-guarded, and its only behavior
 * for a stranger was to bounce to `/login`, which made this app's
 * front door a password field. The daily college quiz needs a home
 * page a visitor can actually use with no account (docs/college-trivia.md),
 * so `/` moved off `authenticatedLayoutRoute` — but it must stay ONE
 * canonical address, since `AppShell`'s brand link and `BottomNav`'s
 * Home tab both point at it, and a logged-in user's home is still the
 * leagues screen with full shell chrome.
 *
 * Reactive on auth state (not a one-shot `getAuthState()` read):
 * logging out while sitting here has to swap this to the public
 * landing, not leave a leagues screen that can no longer load
 * anything.
 */
export function IndexScreen() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) return <PublicHomeScreen />;

  return (
    <MaybeShell>
      <HomeScreen />
    </MaybeShell>
  );
}
