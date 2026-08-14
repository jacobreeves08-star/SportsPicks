import { ErrorState, LoadingState, Stack, Surface, Text } from "../design-system/index.js";
import { PermissionPrompt } from "../notifications/PermissionPrompt.js";
import { PreferencesForm } from "../notifications/PreferencesForm.js";
import { useMe } from "../query/hooks/use-me.js";
import { AccountDeletionSection } from "./profile/AccountDeletionSection.js";
import { EmailSection } from "./profile/EmailSection.js";
import { PasswordSection } from "./profile/PasswordSection.js";
import { ProfileDetailsForm } from "./profile/ProfileDetailsForm.js";
import styles from "./ProfileScreen.module.css";

/**
 * Profile and settings (Epic 11 Step 7): display name/avatar/timezone,
 * email re-verification, password change, notification preferences
 * (Epic 10's real, already-wired `PreferencesForm`/`PermissionPrompt`),
 * and account deletion. Each section owns its own form state and
 * mutation — they're independent saves, not one big form, so a
 * mistake in the password field never blocks saving a display-name
 * change someone actually meant to make right now.
 */
export function ProfileScreen() {
  const { data: me, isLoading, isError, refetch } = useMe();

  if (isLoading) {
    return <LoadingState rows={4} label="Loading your profile" />;
  }

  if (isError) {
    return <ErrorState message="Couldn't load your profile." onRetry={() => void refetch()} />;
  }

  if (!me) {
    return <LoadingState rows={4} label="Loading your profile" />;
  }

  return (
    <Stack gap={5} className={styles.screen}>
      <Text as="h1" size="lg" weight="bold">
        Profile
      </Text>

      <Surface variant="raised" radius="lg" padding={4}>
        <ProfileDetailsForm me={me} />
      </Surface>

      <Surface variant="raised" radius="lg" padding={4}>
        <EmailSection me={me} />
      </Surface>

      <Surface variant="raised" radius="lg" padding={4}>
        <PasswordSection />
      </Surface>

      <Surface variant="raised" radius="lg" padding={4}>
        <Stack gap={3}>
          <Text as="h2" size="md" weight="bold">
            Notifications
          </Text>
          <PermissionPrompt />
          <PreferencesForm />
        </Stack>
      </Surface>

      <Surface variant="raised" radius="lg" padding={4} className={styles.dangerZone}>
        <AccountDeletionSection me={me} />
      </Surface>
    </Stack>
  );
}
