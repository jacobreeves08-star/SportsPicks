import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { confirmPasswordReset } from "../../api/endpoints.js";
import { ApiError } from "../../api/errors.js";
import { Stack, Text } from "../../design-system/index.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import authFormStyles from "../StandaloneForm.module.css";

export function PasswordResetConfirmScreen() {
  const { token } = useSearch({ from: "/password-reset/confirm" });
  const [newPassword, setNewPassword] = useState("");
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: () => confirmPasswordReset({ token: token as string, newPassword }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setClientError("Must be at least 8 characters.");
      return;
    }
    setClientError(undefined);
    mutation.mutate();
  }

  if (!token) {
    return (
      <StandaloneLayout title="Reset your password">
        <Stack gap={3}>
          <Text as="p" color="error" role="alert">
            This link is missing a reset code — copy the full link from your email.
          </Text>
          <Link to="/password-reset" className={authFormStyles.link}>
            Request a new link
          </Link>
        </Stack>
      </StandaloneLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <StandaloneLayout title="Password reset">
        <Stack gap={3}>
          <Text as="p">{mutation.data.message} You can now log in.</Text>
          <Link to="/login" className={authFormStyles.link}>
            Log in
          </Link>
        </Stack>
      </StandaloneLayout>
    );
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const isExpiredToken = mutation.error instanceof ApiError && mutation.error.code === "INVALID_OR_EXPIRED_TOKEN";

  return (
    <StandaloneLayout title="Choose a new password">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          {clientError || serverError?.message ? (
            <Text as="p" color="error" role="alert">
              {clientError ?? serverError?.message}
            </Text>
          ) : null}
          <FormField
            id="reset-confirm-password"
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            hint="At least 8 characters."
            autoComplete="new-password"
            required
          />
          <button
            type="submit"
            disabled={mutation.isPending}
            className={`${authFormStyles.button} ${authFormStyles.buttonPrimary}`}
          >
            {mutation.isPending ? "Resetting…" : "Reset password"}
          </button>
          {isExpiredToken ? (
            <Link to="/password-reset" className={authFormStyles.link}>
              Request a new link
            </Link>
          ) : null}
        </Stack>
      </form>
    </StandaloneLayout>
  );
}
