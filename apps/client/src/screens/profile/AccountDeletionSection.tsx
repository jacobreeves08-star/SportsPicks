import { useState } from "react";
import type { UserProfile } from "../../api/types.js";
import { Stack, Text } from "../../design-system/index.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import { useCancelAccountDeletion, useRequestAccountDeletion } from "./use-profile-mutations.js";

/**
 * Account deletion (Epic 11 brief) — a two-step confirm (not a native
 * `confirm()` dialog, consistent with this app's own form patterns)
 * before the irreversible-feeling action fires, since requesting
 * deletion immediately signs this device out too (users.routes.ts).
 * `deletionRequestedAt` already set (reached by refetching `/users/me`
 * after logging back in during the grace period, per that route's own
 * comment) shows the cancel path instead of the request form.
 */
export function AccountDeletionSection({ me }: { me: UserProfile }) {
  const [confirming, setConfirming] = useState(false);
  const requestDeletion = useRequestAccountDeletion();
  const cancelDeletion = useCancelAccountDeletion();

  if (me.deletionRequestedAt) {
    const cancelError = cancelDeletion.isError ? presentApiError(cancelDeletion.error) : undefined;
    return (
      <Stack gap={3}>
        <Text as="h2" size="md" weight="bold">
          Account deletion
        </Text>
        <Text as="p" color="error">
          Your account is scheduled for deletion on {new Date(me.scheduledDeletionAt!).toLocaleDateString()}.
        </Text>
        {cancelError?.message ? (
          <Text as="p" color="error" role="alert">
            {cancelError.message}
          </Text>
        ) : null}
        <button
          type="button"
          onClick={() => cancelDeletion.mutate()}
          disabled={cancelDeletion.isPending}
          className={formStyles.button}
        >
          {cancelDeletion.isPending ? "Canceling…" : "Cancel deletion"}
        </button>
      </Stack>
    );
  }

  if (requestDeletion.isSuccess) {
    return (
      <Stack gap={3}>
        <Text as="h2" size="md" weight="bold">
          Account deletion
        </Text>
        <Text as="p" color="error" role="status">
          {requestDeletion.data.message}, scheduled for{" "}
          {new Date(requestDeletion.data.scheduledDeletionAt).toLocaleDateString()}. You've been signed out of this
          device — log back in before then to cancel.
        </Text>
      </Stack>
    );
  }

  const requestError = requestDeletion.isError ? presentApiError(requestDeletion.error) : undefined;

  return (
    <Stack gap={3}>
      <Text as="h2" size="md" weight="bold">
        Account deletion
      </Text>
      {requestError?.message ? (
        <Text as="p" color="error" role="alert">
          {requestError.message}
        </Text>
      ) : null}
      {confirming ? (
        <Stack gap={2}>
          <Text as="p" color="error">
            This signs you out and schedules your account for deletion. Are you sure?
          </Text>
          <Stack direction="row" gap={2}>
            <button
              type="button"
              onClick={() => requestDeletion.mutate()}
              disabled={requestDeletion.isPending}
              className={formStyles.button}
            >
              {requestDeletion.isPending ? "Deleting…" : "Yes, delete my account"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={formStyles.button}>
              Cancel
            </button>
          </Stack>
        </Stack>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={formStyles.button}>
          Delete account
        </button>
      )}
    </Stack>
  );
}
