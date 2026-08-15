import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { setAuthTokens } from "../../api/auth-store.js";
import { login } from "../../api/endpoints.js";
import { Stack, Surface, Text } from "../../design-system/index.js";
import { MarketingFooter, MarketingHeader, MarketingSections } from "../marketing/index.js";
import { navigateAfterLogin } from "../../routes/post-login-redirect.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";
import shell from "../marketing/Marketing.module.css";
import styles from "./LoginScreen.module.css";

/**
 * The app's actual front door, and now a real landing page rather than
 * a form on a decorated background: header, hero, proof band, how it
 * works, the sport list, features, the no-account quiz, FAQ, closing
 * CTA, footer — with the login card sitting in the hero so a returning
 * user never has to scroll or navigate to reach it.
 *
 * The login behavior underneath is unchanged and still the point of
 * the screen: this is the call site
 * `routes/post-login-redirect.ts`'s `navigateAfterLogin` was built for
 * in Epic 10, and `?returnTo=` still survives the whole page — every
 * signup link in the marketing chrome carries it too, so a visitor
 * bounced here off a protected route lands back on it whether they log
 * in from the hero or sign up from the footer.
 *
 * The sections below the hero live in `screens/marketing/` rather than
 * in this file: they're not auth, they're not this screen's concern,
 * and `PublicHomeScreen` (`/`, the other logged-out front door) should
 * be able to adopt them without a fork.
 */
export function LoginScreen() {
  const { returnTo } = useSearch({ from: "/login" });
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: (tokens) => {
      setAuthTokens(tokens);
      void navigateAfterLogin(router, returnTo);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  const error = mutation.isError ? presentApiError(mutation.error) : undefined;

  return (
    <div className={shell.page}>
      {/* The page is long now, and the one thing a returning visitor
          came here to do is at the end of the header's tab order. This
          is the standard fix, and it's the first focusable element on
          the page. */}
      <a href="#login" className={shell.skipLink}>
        Skip to log in
      </a>

      {/* `loginAction="anchor"` because this is the one page that
          actually HAS a #login card to jump to. */}
      <MarketingHeader returnTo={returnTo} loginAction="anchor" />

      <main>
        <section className={shell.hero} aria-labelledby="hero-title">
          {/* Decorative "target rings" standing in for a scoreboard/ball
              motif — no image assets in this repo, and no real team
              logos here (this is generic marketing chrome, not a game),
              so an abstract shape carries the sports energy instead. */}
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
                {/* Keep in sync with SPORT_OPTIONS (src/leagues/sports.ts) —
                    11 ESPN-backed codes plus golf, which runs on its own
                    tournament pipeline. */}
                <span className={shell.pill}>12 sports</span>
                <span className={shell.pill}>Friend leagues</span>
                <span className={shell.pill}>Live standings</span>
              </Stack>

              {/* The daily quiz gets hero billing because it's the only
                  thing on this page a visitor with no account can
                  actually DO, and it costs them nothing — burying the
                  one zero-commitment action 2,000px down the page was
                  backwards.

                  It sits in the hero's COPY column, not beside the
                  login card, so it stays above the fold on a phone too
                  — the columns stack in DOM order there, and anything
                  placed after the login card would land well past the
                  fold. Outlined rather than lime-filled so it reads as
                  a genuine second option without competing with the
                  login button next to it. The fuller pitch (new
                  players daily, the rules) still lives in its own
                  section further down for anyone who scrolls. */}
              <div className={styles.quizTeaser}>
                <div className={styles.quizTeaserCopy}>
                  <span className={styles.quizTeaserEyebrow}>Free daily game · no account needed</span>
                  <Text as="p" size="sm" color="dim">
                    <span className={styles.quizTeaserTitle}>Today&rsquo;s College Quiz</span> — five NFL players, five
                    colleges each.
                  </Text>
                </div>
                <Link to="/college-quiz" className={styles.quizTeaserButton}>
                  Play now
                </Link>
              </div>
            </Stack>

            <div className={shell.heroCardSide}>
              {/* `tabIndex={-1}` is what makes the skip link and every
                  "#login" jump on this page actually move FOCUS here,
                  not just the scroll position — a keyboard user
                  following that link would otherwise land back at the
                  top of the tab order. */}
              <Surface
                as="section"
                id="login"
                tabIndex={-1}
                aria-labelledby="login-title"
                variant="raised"
                radius="lg"
                elevation={2}
                padding={5}
                className={shell.heroCard}
              >
                <Stack gap={4}>
                  <Stack gap={1}>
                    {/* An h2, not an h1 — the hero headline is this
                        page's one h1 now. The heading level is the only
                        thing that changed; this is still the form's own
                        labelled section. */}
                    <Text as="h2" id="login-title" size="lg" weight="bold" className={shell.heroCardTitle}>
                      Log in
                    </Text>
                    <Text as="p" color="dim" size="sm">
                      Pick up where your league left off.
                    </Text>
                  </Stack>
                  <form onSubmit={handleSubmit} noValidate>
                    <Stack gap={3}>
                      {error?.message ? (
                        <Text as="p" color="error" role="alert">
                          {error.message}
                        </Text>
                      ) : null}
                      <FormField
                        id="login-email"
                        label="Email"
                        type="email"
                        value={email}
                        onChange={setEmail}
                        autoComplete="email"
                        required
                      />
                      <FormField
                        id="login-password"
                        label="Password"
                        type="password"
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="submit"
                        disabled={mutation.isPending}
                        className={`${authFormStyles.button} ${authFormStyles.buttonPrimary}`}
                      >
                        {mutation.isPending ? "Logging in…" : "Log in"}
                      </button>
                      <Stack direction="row" justify="between">
                        <Link to="/password-reset" className={authFormStyles.link}>
                          Forgot password?
                        </Link>
                        <Link to="/signup" search={{ returnTo }} className={authFormStyles.link}>
                          Sign up
                        </Link>
                      </Stack>
                    </Stack>
                  </form>
                </Stack>
              </Surface>
            </div>
          </div>
        </section>

        <MarketingSections returnTo={returnTo} loginAction="anchor" />
      </main>

      <MarketingFooter returnTo={returnTo} />
    </div>
  );
}
