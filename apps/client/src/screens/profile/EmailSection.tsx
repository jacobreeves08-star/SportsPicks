import { type FormEvent, useState } from "react";
import type { UserProfile } from "../../api/types.js";
import { Stack, Text } from "../../design-system/index.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import { useRequestEmailChange } from "./use-profile-mutations.js";

/**
 * Email, with re-verification (Epic 11 brief). Changing email never
 * takes effect immediately — `POST /users/me/email` sets `pendingEmail`
 * and mails a confirmation link to the NEW address; the account's real
 * `email` only flips once that link is clicked (verify-email-change.ts,
 * Epic 8). This section reflects that: a pending change shows the
 * address awaiting confirmation, not a switched current email.
 */
export function EmailSection({ me }: { me: UserProfile }) {
  const [newEmail, setNewEmail] = useState("");
  const mutation = useRequestEmailChange();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate(newEmail);
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;

  return (
    <Stack gap={3}>
      <Text as="h2" size="md" weight="bold">
        Email
      </Text>
      <Stack gap={1}>
        <Text>{me.email}</Text>
        <Text size="sm" color={me.emailVerifiedAt ? "hit" : "error"}>
          {me.emailVerifiedAt ? "Verified" : "Not verified"}
        </Text>
        {me.pendingEmail ? (
          <Text size="sm" color="dim">
            Confirmation sent to {me.pendingEmail} — check your inbox to finish the change.
          </Text>
        ) : null}
      </Stack>
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          {serverError?.message ? (
            <Text as="p" color="error" role="alert">
              {serverError.message}
            </Text>
          ) : null}
          {mutation.isSuccess ? (
            <Text as="p" size="sm" color="open" role="status">
              {mutation.data.message}
            </Text>
          ) : null}
          <FormField
            id="profile-new-email"
            label="New email"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            autoComplete="email"
            required
          />
          <button type="submit" disabled={mutation.isPending} className={formStyles.button}>
            {mutation.isPending ? "Sending…" : "Change email"}
          </button>
        </Stack>
      </form>
    </Stack>
  );
}
