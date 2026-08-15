import { Link } from "@tanstack/react-router";
import { Stack, Surface, Text } from "../design-system/index.js";
import { MarketingFooter, MarketingHeader, MarketingSections } from "./marketing/index.js";
import shell from "./marketing/Marketing.module.css";
import styles from "./PublicHomeScreen.module.css";

/**
 * The home page for a visitor with no account, and — unlike `/login` —
 * the address a stranger actually arrives at when they type the
 * domain. That made it the app's real front door all along, which is
 * why it now renders the same marketing site `/login` does rather than
 * the short two-pane card it used to: everything below the hero is
 * literally the same `MarketingSections`, not a copy of it.
 *
 * What differs is the hero's card, and only that. `/login` puts the
 * login form there because a visitor who navigated to `/login` came to
 * log in. This page puts the daily quiz there because a visitor who
 * landed on `/` mostly hasn't heard of this yet, and the quiz is the
 * one thing they can do without an account (docs/college-trivia.md's
 * first trigger). Log in and sign up stay one tap away in the header.
 */
export function PublicHomeScreen() {
  return (
    <div className={shell.page}>
      {/* The page is long, and the one thing a visitor can do here
          without an account sits past the whole header. First
          focusable element on the page. */}
      <a href="#play" className={shell.skipLink}>
        Skip to today&rsquo;s quiz
      </a>

      {/* Default `loginAction="route"` — there is no login form on this
          page, so the header's "Log in" has to navigate to /login
          rather than jump to a #login card that doesn't exist here. */}
      <MarketingHeader />

      <main>
        <section className={shell.hero} aria-labelledby="hero-title">
          {/* Same decorative "target rings" motif as the login hero — no
              image assets exist in this repo, and no real team logos
              belong on generic marketing chrome. */}
          <span className={`${shell.ring} ${shell.ringOuter}`} aria-hidden="true" />
          <span className={`${shell.ring} ${shell.ringInner}`} aria-hidden="true" />

          <div className={shell.heroInner}>
            <Stack gap={5} className={shell.heroContent}>
              <span className={shell.heroBadge}>Free · No spreads · No strangers</span>
              <Stack gap={3}>
                <h1 id="hero-title" className={shell.headline}>
                  Pick your winners.
                  <br />
                  Own the week.
                </h1>
                <Text as="p" color="dim" className={shell.tagline}>
                  Weekly pick&rsquo;em leagues across football, basketball, baseball, hockey, soccer, tennis, MMA, and
                  golf — go head-to-head with your own friends, not strangers.
                </Text>
              </Stack>
              <Stack direction="row" gap={2} wrap>
                <span className={shell.pill}>12 sports</span>
                <span className={shell.pill}>Friend leagues</span>
                <span className={shell.pill}>Live standings</span>
              </Stack>
            </Stack>

            <div className={shell.heroCardSide}>
              {/* The no-login trigger, given the hero card slot that
                  `/login` gives its form. `tabIndex={-1}` makes the
                  skip link move real FOCUS here, not just scroll.

                  A plain div, NOT `as="section"` with an
                  `aria-labelledby` — that's what `/login`'s hero card
                  does, but it works there only because its card is
                  named "Log in". Here the card and the shared quiz
                  section further down are about the same thing, so
                  naming both would put two identically-named `region`
                  landmarks on one page and leave a screen-reader user
                  unable to tell them apart (axe `landmark-unique`,
                  which caught exactly this). The heading below is what
                  labels this card; it doesn't need to be a landmark
                  too. */}
              <Surface
                id="play"
                tabIndex={-1}
                variant="raised"
                radius="lg"
                elevation={2}
                padding={5}
                className={shell.heroCard}
              >
                <Stack gap={4}>
                  <Stack gap={2}>
                    <span className={styles.cardEyebrow}>Free daily game · no account needed</span>
                    <Text as="h2" id="play-title" size="lg" weight="bold" className={shell.heroCardTitle}>
                      Today&rsquo;s College Quiz
                    </Text>
                    <Text as="p" color="dim" size="sm">
                      Five NFL players, five colleges each. Which school did each one go to? New players every day, and
                      nothing to sign up for.
                    </Text>
                  </Stack>
                  <Link to="/college-quiz" className={styles.playButton}>
                    Play now
                  </Link>
                </Stack>
              </Surface>
            </div>
          </div>
        </section>

        <MarketingSections />
      </main>

      <MarketingFooter />
    </div>
  );
}
