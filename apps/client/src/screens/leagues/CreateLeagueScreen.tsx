import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createLeague } from "../../api/endpoints.js";
import { LoadingState, Stack, Surface, Text } from "../../design-system/index.js";
import { setCurrentLeagueId } from "../../leagues/current-league-store.js";
import { SPORT_OPTIONS } from "../../leagues/sports.js";
import { useMe } from "../../query/hooks/use-me.js";
import { slateIndexPath } from "../../routes/paths.js";
import { FormField } from "../FormField.js";
import { TimezoneSelect } from "../TimezoneSelect.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import styles from "./CreateLeagueScreen.module.css";
import { GolfSettingsFields } from "./GolfSettingsFields.js";
import { PickHorizonSelect } from "./PickHorizonSelect.js";

/**
 * `createLeagueRoute`'s (`/leagues/new`) component. Authenticated —
 * lives under `authenticatedLayoutRoute`, so it renders inside the
 * normal `AppShell` chrome, not `StandaloneLayout`.
 */
export function CreateLeagueScreen() {
  const { data: me } = useMe();
  const router = useRouter();
  const [name, setName] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [seasonStart, setSeasonStart] = useState("");
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);
  const [pickHorizonDays, setPickHorizonDays] = useState(7);
  const [golfPickCount, setGolfPickCount] = useState(3);
  const [golfTopN, setGolfTopN] = useState(10);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () =>
      createLeague({
        name,
        sports,
        timezone: timezoneOverride ?? me!.timezone,
        seasonStart,
        pickHorizonDays,
        // Only sent for a league that actually covers golf — otherwise
        // the server's own defaults apply and these two are inert.
        ...(sports.includes("golf") && { golfPickCount, golfTopN }),
      }),
    onSuccess: (created) => {
      setCurrentLeagueId(created.id);
    },
  });

  if (!me) {
    return <LoadingState rows={3} label="Loading" />;
  }

  const timezone = timezoneOverride ?? me.timezone;

  function toggleSport(value: string) {
    setSports((current) => (current.includes(value) ? current.filter((s) => s !== value) : [...current, value]));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Required.";
    if (sports.length === 0) errors.sports = "Pick at least one sport.";
    if (!seasonStart) errors.seasonStart = "Required.";
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate();
  }

  if (mutation.isSuccess) {
    const created = mutation.data;
    return (
      <Stack gap={4}>
        <Text as="h1" size="lg" weight="bold">
          League created
        </Text>
        <Surface variant="raised" radius="lg" padding={4}>
          <Stack gap={4} align="center">
            <Text as="p" color="dim">
              Share this code so others can join <strong>{created.name}</strong>:
            </Text>
            <Text as="p" size="xl" weight="bold" tabular className={styles.inviteCode}>
              {created.inviteCode}
            </Text>
            <button
              type="button"
              onClick={() => void router.navigate({ to: slateIndexPath(created.id) })}
              className={`${formStyles.button} ${formStyles.buttonPrimary}`}
            >
              Continue
            </button>
          </Stack>
        </Surface>
      </Stack>
    );
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const fieldErrors = { ...clientErrors, ...serverError?.fieldErrors };

  return (
    <Stack gap={4}>
      <Text as="h1" size="lg" weight="bold">
        Create a league
      </Text>
      <Surface variant="raised" radius="lg" padding={4}>
        <form onSubmit={handleSubmit} noValidate>
          <Stack gap={3}>
            {serverError?.message ? (
              <Text as="p" color="error" role="alert">
                {serverError.message}
              </Text>
            ) : null}
            <FormField id="league-name" label="Name" value={name} onChange={setName} error={fieldErrors.name} required />

            <Stack gap={1}>
              <Text size="sm" weight="medium">
                Sports
              </Text>
              <Stack gap={2} role="group" aria-label="Sports" direction="row" wrap>
                {SPORT_OPTIONS.map((option) => {
                  const checked = sports.includes(option.value);
                  return (
                    <label key={option.value} className={checked ? styles.chipChecked : styles.chip}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSport(option.value)}
                        className={styles.chipInput}
                      />
                      <Text size="sm" weight="medium">
                        {option.label}
                      </Text>
                    </label>
                  );
                })}
              </Stack>
              {fieldErrors.sports ? (
                <Text size="xs" color="error" role="alert">
                  {fieldErrors.sports}
                </Text>
              ) : null}
            </Stack>

            <FormField
              id="league-season-start"
              label="Season start"
              type="date"
              value={seasonStart}
              onChange={setSeasonStart}
              error={fieldErrors.seasonStart}
              required
            />

            <TimezoneSelect
              id="league-timezone"
              label="Timezone"
              value={timezone}
              onChange={setTimezoneOverride}
              hint="Games lock and daily standings reset on this league's clock, not each member's own."
              error={fieldErrors.timezone}
            />

            <PickHorizonSelect
              id="league-pick-horizon"
              value={pickHorizonDays}
              onChange={setPickHorizonDays}
              hint="How far ahead members can pick a game. You can change this later."
              error={fieldErrors.pickHorizonDays}
            />

            {sports.includes("golf") ? (
              <GolfSettingsFields
                golfPickCount={golfPickCount}
                golfTopN={golfTopN}
                onPickCountChange={setGolfPickCount}
                onTopNChange={setGolfTopN}
                errors={fieldErrors}
              />
            ) : null}

            <button
              type="submit"
              disabled={mutation.isPending}
              className={`${formStyles.button} ${formStyles.buttonPrimary}`}
            >
              {mutation.isPending ? "Creating…" : "Create league"}
            </button>
          </Stack>
        </form>
      </Surface>
    </Stack>
  );
}
