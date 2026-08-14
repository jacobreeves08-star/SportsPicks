import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { putGolfPick } from "../api/endpoints.js";
import type { GolfCurrentResponse } from "../api/types.js";
import { EmptyState, ErrorState, LoadingState, NumericText, Stack, Surface, Text } from "../design-system/index.js";
import { useGolfCurrent } from "../query/hooks/use-golf-current.js";
import { useMyLeagues } from "../query/hooks/use-my-leagues.js";
import { queryKeys } from "../query/keys.js";
import formStyles from "./StandaloneForm.module.css";
import styles from "./GolfScreen.module.css";
import { presentApiError } from "./present-api-error.js";

/**
 * `/leagues/:leagueId/golf` — golf's own screen, deliberately NOT the
 * slate. A tournament is one ~69-competitor leaderboard, so the
 * interaction is "choose N golfers from a list" (a multi-select), not
 * PickControl's two-sided choice; and the result display is a ranked
 * leaderboard with a top-N cut line, not a per-game win/loss badge.
 *
 * Before the tournament starts, the list is a picker. Once it locks,
 * the same list becomes a read-only leaderboard with the member's own
 * picks highlighted — one component, two modes, rather than two
 * screens, since the underlying data is identical either way.
 */
export function GolfScreen() {
  const { leagueId } = useParams({ from: "/_authenticated/leagues/$leagueId/golf" });
  const { data, isLoading, isError, refetch } = useGolfCurrent(leagueId);
  const { data: myLeagues } = useMyLeagues();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);

  // Sync local selection from the server's copy whenever it changes
  // (first load, a refetch after a successful write, or a poll that
  // picked up a change made on another device).
  useEffect(() => {
    if (data?.myPick) setSelected(data.myPick);
  }, [data?.myPick]);

  const leagueMemberId = myLeagues?.find((l) => l.id === leagueId)?.leagueMemberId;

  const mutation = useMutation({
    mutationFn: (golferExternalIds: string[]) => {
      if (!leagueMemberId || !data?.tournament) throw new Error("not ready");
      return putGolfPick(leagueId, leagueMemberId, data.tournament.id, golferExternalIds);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.golfCurrent(leagueId) });
    },
  });

  if (isLoading) {
    return <LoadingState rows={5} label="Loading golf tournament" />;
  }

  if (isError || !data) {
    return <ErrorState message="Couldn't load the golf tournament." onRetry={() => void refetch()} />;
  }

  if (!data.tournament) {
    return (
      <EmptyState
        title="No tournament right now"
        description="Golf picks open when the next tournament is announced."
      />
    );
  }

  const { tournament, leaderboard, golfPickCount, golfTopN } = data;
  const locked = tournament.locked;
  const selectionComplete = selected.length === golfPickCount;

  function toggleGolfer(externalId: string) {
    setSelected((current) => {
      if (current.includes(externalId)) return current.filter((id) => id !== externalId);
      // Silently ignore a tap past the limit rather than swapping one
      // out — an accidental extra tap shouldn't quietly drop a pick the
      // member deliberately made.
      if (current.length >= golfPickCount) return current;
      return [...current, externalId];
    });
  }

  const serverError = mutation.isError ? presentApiError(mutation.error) : undefined;

  return (
    <Stack gap={4} className={styles.screen}>
      <Surface variant="raised" radius="lg" padding={4}>
        <Stack gap={1}>
          <Text as="h1" size="lg" weight="bold">
            {tournament.name}
          </Text>
          <Text size="sm" color="dim">
            {locked
              ? `Picks locked. Top ${golfTopN} counts as a win.`
              : `Pick ${golfPickCount} golfer${golfPickCount === 1 ? "" : "s"}. A top-${golfTopN} finish by any of them counts as a win.`}
          </Text>
        </Stack>
      </Surface>

      {!locked ? (
        <Surface variant="raised" radius="lg" padding={4}>
          <Stack gap={3}>
            {serverError?.message ? (
              <Text as="p" color="error" role="alert">
                {serverError.message}
              </Text>
            ) : null}
            {mutation.isSuccess ? (
              <Text as="p" size="sm" color="open" role="status">
                Picks saved.
              </Text>
            ) : null}
            <Stack direction="row" justify="between" align="center" gap={3}>
              <Text size="sm" color="dim">
                {selected.length} of {golfPickCount} selected
              </Text>
              <button
                type="button"
                disabled={!selectionComplete || mutation.isPending || !leagueMemberId}
                onClick={() => mutation.mutate(selected)}
                className={`${formStyles.button} ${formStyles.buttonPrimary}`}
              >
                {mutation.isPending ? "Saving…" : "Save picks"}
              </button>
            </Stack>
          </Stack>
        </Surface>
      ) : null}

      {leaderboard.length === 0 ? (
        <EmptyState title="No field yet" description="The tournament field hasn't been published." />
      ) : (
        <Stack as="ul" gap={2} className={styles.list}>
          {leaderboard.map((entry) => {
            const isSelected = selected.includes(entry.externalId);
            const inTopN = entry.position !== null && entry.position <= golfTopN;
            return (
              <li key={entry.externalId}>
                <GolferRow
                  entry={entry}
                  selected={isSelected}
                  inTopN={inTopN}
                  locked={locked}
                  onToggle={() => toggleGolfer(entry.externalId)}
                />
              </li>
            );
          })}
        </Stack>
      )}

      <OtherPicks otherPicks={data.otherPicks} locked={locked} />
    </Stack>
  );
}

function GolferRow({
  entry,
  selected,
  inTopN,
  locked,
  onToggle,
}: {
  entry: GolfCurrentResponse["leaderboard"][number];
  selected: boolean;
  inTopN: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  const body = (
    <Surface variant="raised" radius="md" padding={3} className={selected ? styles.rowSelected : styles.row}>
      <Stack direction="row" justify="between" align="center" gap={3}>
        <Stack direction="row" gap={2} align="center">
          <NumericText weight="bold" size="sm" className={styles.positionBadge}>
            {entry.position ?? "—"}
          </NumericText>
          <Text weight={selected ? "bold" : "regular"}>{entry.golferName}</Text>
        </Stack>
        {locked && inTopN ? (
          <Text size="xs" weight="medium" color="hit">
            Top finish
          </Text>
        ) : null}
      </Stack>
    </Surface>
  );

  if (locked) return body;

  return (
    <button type="button" onClick={onToggle} aria-pressed={selected} className={styles.rowButton}>
      {body}
    </button>
  );
}

function OtherPicks({ otherPicks, locked }: { otherPicks: GolfCurrentResponse["otherPicks"]; locked: boolean }) {
  if (otherPicks.length === 0) return null;
  return (
    <Surface variant="raised" radius="lg" padding={4}>
      <Stack gap={2}>
        <Text size="sm" weight="medium">
          League
        </Text>
        {otherPicks.map((member) => (
          <Stack key={member.leagueMemberId} direction="row" justify="between" align="center" gap={3}>
            <Text size="sm">{member.displayName}</Text>
            <Text size="xs" color="dim">
              {!member.hasPicked
                ? "No picks yet"
                : locked && member.golferExternalIds
                  ? `${member.golferExternalIds.length} picked`
                  : "Picked"}
            </Text>
          </Stack>
        ))}
      </Stack>
    </Surface>
  );
}
