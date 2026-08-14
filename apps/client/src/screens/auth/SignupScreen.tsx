import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { signup } from "../../api/endpoints.js";
import { Stack, Text } from "../../design-system/index.js";
import { getDetectedTimezone } from "../../timezone/timezones.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import { FormField } from "../FormField.js";
import { TimezoneSelect } from "../TimezoneSelect.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";

export function SignupScreen() {
  const { returnTo } = useSearch({ from: "/signup" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(() => getDetectedTimezone());
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => signup({ email, password, displayName, timezone }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!displayName.trim()) errors.displayName = "Required.";
    if (password.length < 8) errors.password = "Must be at least 8 characters.";
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate();
  }

  if (mutation.isSuccess) {
    return (
      <StandaloneLayout title="Check your email">
        <Stack gap={3}>
          <Text as="p">{mutation.data.message}</Text>
          <Link to="/login" search={{ returnTo }} className={authFormStyles.link}>
            Back to login
          </Link>
        </Stack>
      </StandaloneLayout>
    );
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const fieldErrors = { ...clientErrors, ...serverError?.fieldErrors };

  return (
    <StandaloneLayout title="Create your account">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          {serverError?.message ? (
            <Text as="p" color="error" role="alert">
              {serverError.message}
            </Text>
          ) : null}
          <FormField
            id="signup-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />
          <FormField
            id="signup-display-name"
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            error={fieldErrors.displayName}
            autoComplete="name"
            required
          />
          <FormField
            id="signup-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            error={fieldErrors.password}
            hint="At least 8 characters."
            autoComplete="new-password"
            required
          />
          <TimezoneSelect
            id="signup-timezone"
            label="Timezone"
            value={timezone}
            onChange={setTimezone}
            hint="This determines when your picks lock and when your daily standings reset — we picked it up from your browser, but change it if it's wrong."
            error={fieldErrors.timezone}
          />
          <button
            type="submit"
            disabled={mutation.isPending}
            className={`${authFormStyles.button} ${authFormStyles.buttonPrimary}`}
          >
            {mutation.isPending ? "Signing up…" : "Sign up"}
          </button>
          <Text as="p" size="sm">
            Already have an account?{" "}
            <Link to="/login" search={{ returnTo }} className={authFormStyles.link}>
              Log in
            </Link>
          </Text>
        </Stack>
      </form>
    </StandaloneLayout>
  );
}
