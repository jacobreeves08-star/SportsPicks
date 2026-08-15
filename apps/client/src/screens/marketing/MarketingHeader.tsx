import { Link } from "@tanstack/react-router";
import styles from "./Marketing.module.css";

/**
 * Where a "log in" control in the marketing chrome should point.
 *
 * `"anchor"` jumps to the `#login` card on the same page — correct
 * only on `/login`, which actually has one. `"route"` navigates to
 * `/login`, which is what every other page needs: an `href="#login"`
 * on a page with no such element is a link that silently does nothing.
 *
 * Declared here, alongside the header that first needed it, and
 * imported by `MarketingSections` for its closing CTA — the two
 * components render the same affordance and have to agree on it.
 */
export type MarketingLoginAction = "anchor" | "route";

export interface MarketingHeaderProps {
  /** Threaded straight through to the signup link so the session-expiry
   * contract survives a detour through the marketing chrome — a visitor
   * bounced here from a protected route who signs up from the HEADER
   * still lands back where they were, exactly like one who used the
   * link inside the login card. */
  returnTo?: string;
  /** Defaults to `"route"` — the safe answer anywhere, since it works
   * on a page with or without a login form. */
  loginAction?: MarketingLoginAction;
}

/**
 * The site header for the logged-out front door — deliberately NOT
 * `app-shell/AppShell`'s nav, which is the authenticated bottom-nav
 * chrome and assumes a session, a current league, and real data behind
 * every destination. This one navigates a marketing page: in-page
 * anchors plus the two account actions.
 */
export function MarketingHeader({ returnTo, loginAction = "route" }: MarketingHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          Pick&rsquo;em
        </Link>

        {/* Named, because this page has a second <nav> in the footer —
            two unlabeled navigation landmarks is exactly the kind of
            thing a screen-reader user has to guess between. */}
        <nav aria-label="Page sections">
          <ul className={styles.navLinks}>
            <li>
              <a href="#how-it-works" className={styles.navLink}>
                How it works
              </a>
            </li>
            <li>
              <a href="#sports" className={styles.navLink}>
                Sports
              </a>
            </li>
            <li>
              <a href="#features" className={styles.navLink}>
                Features
              </a>
            </li>
            <li>
              <a href="#faq" className={styles.navLink}>
                FAQ
              </a>
            </li>
          </ul>
        </nav>

        <div className={styles.headerActions}>
          {loginAction === "anchor" ? (
            // An in-page jump, not a route change — the login form is
            // already on this page, and routing to /login from /login
            // would be a no-op that silently does nothing.
            <a href="#login" className={styles.headerLogin}>
              Log in
            </a>
          ) : (
            <Link to="/login" search={{ returnTo }} className={styles.headerLogin}>
              Log in
            </Link>
          )}
          <Link to="/signup" search={{ returnTo }} className={styles.buttonPrimary}>
            Sign up free
          </Link>
        </div>
      </div>
    </header>
  );
}
