import { Link } from "@tanstack/react-router";
import { Stack, Text } from "../../design-system/index.js";
import styles from "./Marketing.module.css";

export interface MarketingFooterProps {
  returnTo?: string;
}

/**
 * The site footer for the logged-out front door.
 *
 * Every entry here points at a route that actually exists in
 * `routes/route-tree.tsx` or a section of this same page. There are
 * deliberately no Privacy / Terms links yet: `docs/legal/` holds both
 * documents, but neither is served by any client route, so linking
 * them would ship two guaranteed 404s on the most-scrutinized page in
 * the app. Worth adding as its own small piece of work — two static
 * routes rendering that Markdown — rather than faked here.
 */
export function MarketingFooter({ returnTo }: MarketingFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerTop}>
          <Stack gap={3}>
            <Link to="/" className={styles.brand}>
              <span className={styles.brandDot} aria-hidden="true" />
              Pick&rsquo;em
            </Link>
            <Text as="p" color="dim" size="sm" className={styles.sectionLead}>
              Weekly pick&rsquo;em leagues for people who&rsquo;d rather beat their friends than a sportsbook.
            </Text>
          </Stack>

          <nav aria-label="Site sections">
            <Stack gap={3}>
              <h2 className={styles.footerHeading}>Product</h2>
              <ul className={styles.footerList}>
                <li>
                  <a href="#how-it-works" className={styles.footerLink}>
                    How it works
                  </a>
                </li>
                <li>
                  <a href="#sports" className={styles.footerLink}>
                    Sports
                  </a>
                </li>
                <li>
                  <a href="#features" className={styles.footerLink}>
                    Features
                  </a>
                </li>
                <li>
                  <a href="#faq" className={styles.footerLink}>
                    FAQ
                  </a>
                </li>
              </ul>
            </Stack>
          </nav>

          <nav aria-label="Account">
            <Stack gap={3}>
              <h2 className={styles.footerHeading}>Account</h2>
              <ul className={styles.footerList}>
                <li>
                  <Link to="/signup" search={{ returnTo }} className={styles.footerLink}>
                    Create an account
                  </Link>
                </li>
                <li>
                  <Link to="/password-reset" className={styles.footerLink}>
                    Reset your password
                  </Link>
                </li>
                <li>
                  <Link to="/college-quiz" className={styles.footerLink}>
                    Daily college quiz
                  </Link>
                </li>
              </ul>
            </Stack>
          </nav>
        </div>

        <div className={styles.footerBottom}>
          {/* Real league names appear all over this page (NFL, Premier
              League, ...) as the sports a league can cover. Saying
              plainly that none of them endorse this is both accurate
              and the norm for any product that names them. */}
          <Text as="p" color="dim" size="xs">
            © {new Date().getFullYear()} Pick&rsquo;em. Not affiliated with, endorsed by, or licensed by any league,
            team, or governing body. No wagering.
          </Text>
        </div>
      </div>
    </footer>
  );
}
