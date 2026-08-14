import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { updateLeague } from "../../api/endpoints.js";
import { ErrorState, LoadingState, Stack, Surface, Text } from "../../design-system/index.js";
import { SPORT_OPTIONS } from "../../leagues/sports.js";
import { useLeague } from "../../query/hooks/use-league.js";
import { useMe } from "../../query/hooks/use-me.js";
import { queryKeys } from "../../query/keys.js";
import { FormField } from "../FormField.js";
import { presentApiError } from "../present-api-error.js";
import formStyles from "../StandaloneForm.module.css";
import { GolfSettingsFields } from "./GolfSettingsFields.js";
import styles from "./LeagueSettingsScreen.module.css";
import { PickHorizonSelect } from "./PickHorizonSelect.js";

/**
 * `/leagues/:leagueId/settings` — commissioner-only (Epic 11 follow-up:
 * the pick-horizon feature needed somewhere to actually set it).
 * `name`/`sports`/`pickHorizonDays` share one `updateLeague` PATCH,
 * same "independent saves per section" posture as `ProfileScreen`
 * would use for multiple forms — but here it's genuinely one form,
 * since a commissioner changing sports and the horizon at once is the
 * common case, not three unrelated concerns.
 */
export function LeagueSettingsScreen() {
  const { leagueId } = useParams({ from: "/_authenticated/leagues/$leagueId/settings" });
  const { data: me } = useMe();
  const { data: league, isLoading, isError, refetch } = useLeague(leagueId);
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [pickHorizonDays, setPickHorizonDays] = useState(7);
  const [golfPickCount, setGolfPickCount] = useState(3);
  const [golfTopN, setGolfTopN] = useState(10);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!league) return;
    setName(league.name);
    setSports(league.sports);
    setPickHorizonDays(league.pickHorizonDays);
    setGolfPickCount(league.golfPickCount);
    setGolfTopN(league.golfTopN);
  }, [league]);

  const mutation = useMutation({
    mutationFn: () =>
      updateLeague(leagueId, {
        name,
        sports,
        pickHorizonDays,
        // Only sent for a league that covers golf — see the same
        // reasoning in CreateLeagueScreen.
        ...(sports.includes("golf") && { golfPickCount, golfTopN }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.league(leagueId), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myLeagues() });
    },
  });

  if (isLoading || !me) {
    return <LoadingState rows={4} label="Loading league settings" />;
  }

  if (isError || !league) {
    return <ErrorState message="Couldn't load this league." onRetry={() => void refetch()} />;
  }

  if (league.commissionerId !== me.id) {
    return <ErrorState message="Only the league commissioner can edit these settings." />;
  }

  function toggleSport(value: string) {
    setSports((current) => (current.includes(value) ? current.filter((s) => s !== value) : [...current, value]));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Required.";
    if (sports.length === 0) errors.sports = "Pick at least one sport.";
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate();
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;
  const fieldErrors = { ...clientErrors, ...serverError?.fieldErrors };

  return (
    <Stack gap={4}>
      <Text as="h1" size="lg" weight="bold">
        League settings
      </Text>
      <Surface variant="raised" radius="lg" padding={4}>
        <form onSubmit={handleSubmit} noValidate>
          <Stack gap={3}>
            {serverError?.message ? (
              <Text as="p" color="error" role="alert">
                {serverError.message}
              </Text>
            ) : null}
            {mutation.isSuccess ? (
              <Text as="p" size="sm" color="open" role="status">
                Saved.
              </Text>
            ) : null}

            <FormField id="league-settings-name" label="Name" value={name} onChange={setName} error={fieldErrors.name} required />

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

            <PickHorizonSelect
              id="league-settings-pick-horizon"
              value={pickHorizonDays}
              onChange={setPickHorizonDays}
              hint="How far ahead members can pick a game."
              error={fieldErrors.pickHorizonDays}
            />

            {/* Only shown for a league that actually covers golf — these
                two settings are meaningless otherwise, and hiding them
                keeps the form honest about what applies to this league. */}
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
              {mutation.isPending ? "Saving…" : "Save settings"}
            </button>
          </Stack>
        </form>
      </Surface>
    </Stack>
  );
}
