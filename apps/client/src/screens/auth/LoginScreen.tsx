import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { setAuthTokens } from "../../api/auth-store.js";
import { login } from "../../api/endpoints.js";
import { Stack, Text } from "../../design-system/index.js";
import { navigateAfterLogin } from "../../routes/post-login-redirect.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";

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
    <StandaloneLayout title="Log in">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          {error?.message ? (
            <Text as="p" color="error" role="alert">
              {error.message}
            </Text>
          ) : null}
          <FormField id="login-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
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
    </StandaloneLayout>
  );
}
