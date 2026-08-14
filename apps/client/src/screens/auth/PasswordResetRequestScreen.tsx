import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { requestPasswordReset } from "../../api/endpoints.js";
import { Stack, Text } from "../../design-system/index.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";

export function PasswordResetRequestScreen() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({ mutationFn: () => requestPasswordReset(email) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  if (mutation.isSuccess) {
    return (
      <StandaloneLayout title="Check your email">
        <Stack gap={3}>
          <Text as="p">{mutation.data.message}</Text>
          <Link to="/login" className={authFormStyles.link}>
            Back to login
          </Link>
        </Stack>
      </StandaloneLayout>
    );
  }

  const error = mutation.isError ? presentApiError(mutation.error) : undefined;

  return (
    <StandaloneLayout title="Reset your password">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          <Text as="p" size="sm" color="dim">
            Enter your account email and we'll send you a link to reset your password.
          </Text>
          {error?.message ? (
            <Text as="p" color="error" role="alert">
              {error.message}
            </Text>
          ) : null}
          <FormField id="reset-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <button
            type="submit"
            disabled={mutation.isPending}
            className={`${authFormStyles.button} ${authFormStyles.buttonPrimary}`}
          >
            {mutation.isPending ? "Sending…" : "Send reset link"}
          </button>
          <Link to="/login" className={authFormStyles.link}>
            Back to login
          </Link>
        </Stack>
      </form>
    </StandaloneLayout>
  );
}
