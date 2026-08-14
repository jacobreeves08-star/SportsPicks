import { type FormEvent, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Stack, Text } from "../../design-system/index.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import { FormField } from "../FormField.js";
import formStyles from "../StandaloneForm.module.css";

/**
 * `legacyJoinRoute`'s (`/join`, no `?code=`) component — the manual
 * "I have a code" entry point (Epic 11 brief's "code entry" step),
 * distinct from the deep-link case (`/join/:code` already has the
 * code, no entry needed). Submitting navigates to the canonical
 * `/join/$inviteCode`, which does the actual preview — this screen
 * itself makes no API call.
 */
export function JoinCodeEntryScreen() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    void navigate({ to: "/join/$inviteCode", params: { inviteCode: trimmed } });
  }

  return (
    <StandaloneLayout title="Join a league">
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap={3}>
          <Text as="p" size="sm" color="dim">
            Enter the invite code someone shared with you.
          </Text>
          <FormField id="join-code" label="Invite code" value={code} onChange={setCode} autoComplete="off" required />
          <button type="submit" className={`${formStyles.button} ${formStyles.buttonPrimary}`}>
            Continue
          </button>
        </Stack>
      </form>
    </StandaloneLayout>
  );
}
