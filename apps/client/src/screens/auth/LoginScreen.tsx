import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { setAuthTokens } from "../../api/auth-store.js";
import { login } from "../../api/endpoints.js";
import { Stack, Surface, Text } from "../../design-system/index.js";
import { navigateAfterLogin } from "../../routes/post-login-redirect.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";
import styles from "./LoginScreen.module.css";

/**
 * The screen `routes/post-login-redirect.ts`'s `navigateAfterLogin`
 * was built for in Epic 10, before any login screen existed to call
 * it — this is that call site landing.
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
    <main className={styles.page}>
      <div className={styles.hero}>
        {/* Decorative "target rings" standing in for a scoreboard/ball
            motif — no image assets in this repo, and no real team
            logos here (this is generic marketing chrome, not a game),
            so an abstract shape carries the sports energy instead. */}
        <span className={`${styles.ring} ${styles.ringOuter}`} aria-hidden="true" />
        <span className={`${styles.ring} ${styles.ringInner}`} aria-hidden="true" />
        <Stack gap={5} className={styles.heroContent}>
          <span className={styles.brand}>Pick&rsquo;em</span>
          <Stack gap={3}>
            <p className={styles.headline}>
              Pick your winners.
              <br />
              Own the week.
            </p>
            <Text as="p" color="dim" className={styles.tagline}>
              Weekly pick&rsquo;em leagues across football, basketball, baseball, hockey, soccer, tennis, MMA, and
              golf — go head-to-head with your own friends, not strangers.
            </Text>
          </Stack>
          <Stack direction="row" gap={2} wrap>
            {/* Keep in sync with SPORT_OPTIONS (src/leagues/sports.ts) —
                11 ESPN-backed codes plus golf, which runs on its own
                tournament pipeline. */}
            <span className={styles.pill}>12 sports</span>
            <span className={styles.pill}>Friend leagues</span>
            <span className={styles.pill}>Live standings</span>
          </Stack>
        </Stack>
      </div>
      <div className={styles.formSide}>
        <Surface as="section" variant="raised" radius="lg" elevation={2} padding={5} className={styles.card}>
          <Stack gap={4}>
            <Text as="h1" size="lg" weight="bold">
              Log in
            </Text>
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
    </main>
  );
}
