import { type FormEvent, useState } from "react";
import { Stack, Text } from "../../design-system/index.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import { useChangePassword } from "./use-profile-mutations.js";

/** Password change, requiring the current one (Epic 11 brief) —
 * `POST /users/me/change-password` rejects with `CURRENT_PASSWORD_INCORRECT`
 * if it doesn't match, surfaced here the same way every other server
 * rejection is (`presentApiError`). Clears both fields on success —
 * this account's other sessions were just revoked (users.routes.ts:
 * "decision 9"), so a cleared form paired with the success message is
 * the honest state, not a lingering value that reads as still active. */
export function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const mutation = useChangePassword();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (newPassword.length < 8) errors.newPassword = "Must be at least 8 characters.";
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
        },
      },
    );
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const fieldErrors = { ...clientErrors, ...serverError?.fieldErrors };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap={3}>
        <Text as="h2" size="md" weight="bold">
          Password
        </Text>
        {serverError?.message ? (
          <Text as="p" color="error" role="alert">
            {serverError.message}
          </Text>
        ) : null}
        {mutation.isSuccess ? (
          <Text as="p" size="sm" color="open" role="status">
            {mutation.data.message}. Your other devices have been signed out.
          </Text>
        ) : null}
        <FormField
          id="profile-current-password"
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          required
        />
        <FormField
          id="profile-new-password"
          label="New password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          error={fieldErrors.newPassword}
          hint="At least 8 characters."
          autoComplete="new-password"
          required
        />
        <button type="submit" disabled={mutation.isPending} className={formStyles.button}>
          {mutation.isPending ? "Changing…" : "Change password"}
        </button>
      </Stack>
    </form>
  );
}
