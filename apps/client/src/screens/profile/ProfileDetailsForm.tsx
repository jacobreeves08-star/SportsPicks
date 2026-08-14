import { type FormEvent, useState } from "react";
import type { UserProfile } from "../../api/types.js";
import { Stack, Text } from "../../design-system/index.js";
import { FormField } from "../FormField.js";
import { TimezoneSelect } from "../TimezoneSelect.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import { useUpdateProfile } from "./use-profile-mutations.js";

/**
 * Display name, avatar URL, and timezone (Epic 11 brief). The
 * timezone warning is shown BOTH proactively (a static hint, same
 * posture as signup's own explanation) and reactively — the server's
 * own `warning` string (users.routes.ts's `PATCH /me`) is surfaced
 * after a save that actually changed it, since that's the moment it's
 * most relevant: this save just moved when this person's picks lock.
 */
export function ProfileDetailsForm({ me }: { me: UserProfile }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? "");
  const [timezone, setTimezone] = useState(me.timezone);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const mutation = useUpdateProfile();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!displayName.trim()) errors.displayName = "Required.";
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate({ displayName, avatarUrl: avatarUrl.trim() || undefined, timezone });
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const fieldErrors = { ...clientErrors, ...serverError?.fieldErrors };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap={3}>
        <Text as="h2" size="md" weight="bold">
          Profile
        </Text>
        {serverError?.message ? (
          <Text as="p" color="error" role="alert">
            {serverError.message}
          </Text>
        ) : null}
        {mutation.isSuccess && mutation.data.warning ? (
          <Text as="p" size="sm" color="open" role="status">
            {mutation.data.warning}
          </Text>
        ) : null}
        <FormField
          id="profile-display-name"
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          error={fieldErrors.displayName}
          autoComplete="name"
          required
        />
        <FormField
          id="profile-avatar-url"
          label="Avatar URL"
          value={avatarUrl}
          onChange={setAvatarUrl}
          error={fieldErrors.avatarUrl}
          hint="Optional — a link to an image."
        />
        <TimezoneSelect
          id="profile-timezone"
          label="Timezone"
          value={timezone}
          onChange={setTimezone}
          hint="Changing this changes when your picks lock and when your daily standings reset."
          error={fieldErrors.timezone}
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className={`${formStyles.button} ${formStyles.buttonPrimary}`}
        >
          {mutation.isPending ? "Saving…" : "Save profile"}
        </button>
      </Stack>
    </form>
  );
}
