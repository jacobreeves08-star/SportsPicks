import { Link } from "@tanstack/react-router";
import { Stack, Surface, Text } from "../design-system/index.js";
import styles from "./PublicHomeScreen.module.css";

/**
 * The home page for a visitor with no account — the first thing this
 * app has ever had at `/` for a logged-out user (before the college
 * quiz, `/` was purely an auth-guarded route that bounced straight to
 * `/login`, so a stranger's first impression WAS a login form).
 *
 * It exists because the quiz has to be playable with no login (the
 * feature brief's first trigger), and a shared result link has to land
 * somewhere that isn't a password field. The marketing copy mirrors
 * `screens/auth/LoginScreen`'s hero deliberately — same wordmark, same
 * pills, same voice — so the two read as one product rather than two
 * different front doors.
 */
export function PublicHomeScreen() {
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        {/* Same decorative "target rings" motif as the login hero — no
            image assets exist in this repo, and no real team logos
            belong on generic marketing chrome. */}
        <span className={`${styles.ring} ${styles.ringOuter}`} aria-hidden="true" />
        <span className={`${styles.ring} ${styles.ringInner}`} aria-hidden="true" />

        <Stack gap={5} className={styles.heroContent}>
          <span className={styles.brand}>Pick&rsquo;em</span>
          <Stack gap={3}>
            <h1 className={styles.headline}>
              Pick your winners.
              <br />
              Own the week.
            </h1>
            <Text as="p" color="dim" className={styles.tagline}>
              Weekly pick&rsquo;em leagues across football, basketball, baseball, hockey, soccer, tennis, MMA, and
              golf — go head-to-head with your own friends, not strangers.
            </Text>
          </Stack>
          <Stack direction="row" gap={2} wrap>
            <span className={styles.pill}>12 sports</span>
            <span className={styles.pill}>Friend leagues</span>
            <span className={styles.pill}>Live standings</span>
          </Stack>
        </Stack>
      </div>

      <div className={styles.panel}>
        {/* The no-login trigger. Given top billing over Log in/Sign up
            on purpose: it's the one thing on this page a stranger can
            actually DO, and it costs them nothing. */}
        <Surface as="section" variant="raised" radius="lg" elevation={2} padding={5} className={styles.card}>
          <Stack gap={3}>
            <Stack gap={1}>
              <Text as="h2" size="lg" weight="bold" className={styles.cardTitle}>
                Today&rsquo;s College Quiz
              </Text>
              <Text as="p" color="dim" size="sm">
                Five NFL players, five colleges each. Which school did each one go to? New players every day — no
                account needed.
              </Text>
            </Stack>
            <Link to="/college-quiz" className={styles.playButton}>
              Play today&rsquo;s quiz
            </Link>
          </Stack>
        </Surface>

        <Stack direction="row" gap={2} justify="center" className={styles.authRow}>
          <Link to="/login" className={styles.authButton}>
            Log in
          </Link>
          <Link to="/signup" className={styles.authButtonSecondary}>
            Sign up
          </Link>
        </Stack>
      </div>
    </main>
  );
}
