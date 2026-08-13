import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { writePick } from "../api/endpoints.js";
import { ApiError } from "../api/errors.js";
import type { SlateResponse, WrittenPick } from "../api/types.js";
import { queryKeys } from "../query/keys.js";

export interface PickMutationVariables {
  gameId: string;
  selectedTeam: string;
  /** Which slate cache entry (leagueId, date) to optimistically update —
   * matches `getSlate`'s own optional `date` (server defaults to today
   * in the league's timezone when omitted). This is purely a cache-
   * targeting concern; the write endpoint itself takes no date. */
  date?: string;
}

/**
 * A rejected (or network-failed) pick write that has NOT yet been
 * acknowledged by a screen. This is the "visible and explained revert"
 * the brief requires, enforced at the framework level: this hook never
 * clears its own rejection state on a timer, and a screen has no other
 * way to reach the cache to make the revert silent — the only paths
 * back to a clean slate are `dismissRejection()` (an explicit
 * acknowledgment) or a NEW attempt on the same game (onMutate clears
 * any stale rejection for a fresh try). A three-second toast is
 * exactly the failure mode this design refuses to allow: nothing here
 * self-dismisses.
 */
export interface PickRejection {
  gameId: string;
  attemptedSelectedTeam: string;
  /** What the pick control now shows again, after the revert — the
   * server's last known truth for this game, or `null` if there was
   * no prior pick at all. A screen should display THIS value, paired
   * with an explanation of `reason`, not just make the control blank. */
  revertedTo: string | null;
  reason: ApiError;
}

/**
 * The one shared hook for writing a pick (Epic 8 brief) — optimistic
 * fill, server confirm, and a revert that is impossible to make silent
 * by accident. This is the highest-stakes interaction in the app: a
 * member believes they picked, closes the app, and only discovers at
 * the standings screen that the write never actually landed. See
 * mutations/README (this file's own doc) for why every step below
 * exists.
 */
export function usePickMutation(leagueId: string, memberId: string) {
  const queryClient = useQueryClient();
  const [rejection, setRejection] = useState<PickRejection | null>(null);

  const mutation = useMutation<WrittenPick, ApiError, PickMutationVariables, { queryKey: readonly unknown[]; previousSlate: SlateResponse | undefined }>({
    mutationFn: (variables) => writePick(leagueId, memberId, variables.gameId, variables.selectedTeam),

    // INSTANT LOCAL FILL — deliberately a SYNCHRONOUS function, not
    // `async`. `mutate()` invokes `onMutate` synchronously up to its
    // first `await`; an `async onMutate` that starts with
    // `await queryClient.cancelQueries(...)` defers the actual cache
    // write to a later microtask, which measurably breaks "instant" —
    // confirmed empirically (a test asserting the cache reflects the
    // pick immediately after calling `writePick()`, with zero `await`
    // in between, failed until this was made synchronous). Cancelling
    // any in-flight refetch for this slate still happens — fired
    // without being awaited, since the abort signal it sends dispatches
    // synchronously when `cancelQueries` is called; not awaiting its
    // settlement promise is exactly what keeps this function, and the
    // write below, synchronous.
    onMutate: (variables) => {
      const queryKey = queryKeys.slate(leagueId, variables.date);
      void queryClient.cancelQueries({ queryKey });

      const previousSlate = queryClient.getQueryData<SlateResponse>(queryKey);

      // A fresh attempt on this game supersedes any stale, unacknowledged
      // rejection from a prior attempt — the user trying again IS the
      // acknowledgment. A rejection for a DIFFERENT game is left alone;
      // it's still unacknowledged and still needs its own resolution.
      setRejection((current) => (current?.gameId === variables.gameId ? null : current));

      if (previousSlate) {
        const alreadyCountedAsPicked = previousSlate.games.find((g) => g.gameId === variables.gameId)?.myPick !== null;
        const optimisticSlate: SlateResponse = {
          ...previousSlate,
          games: previousSlate.games.map((game) =>
            game.gameId === variables.gameId
              ? {
                  ...game,
                  myPick: variables.selectedTeam,
                  pickState: game.pickState === "unpicked" ? "picked_open" : game.pickState,
                }
              : game,
          ),
          pickedCount: alreadyCountedAsPicked ? previousSlate.pickedCount : previousSlate.pickedCount + 1,
        };
        queryClient.setQueryData(queryKey, optimisticSlate);
      }

      return { queryKey, previousSlate };
    },

    // SERVER CONFIRM — reconcile with the server's actual response
    // (authoritative regardless of what the optimistic guess assumed;
    // in the ordinary case they match, but the server's value always
    // wins if they ever don't).
    onSuccess: (writtenPick, variables) => {
      const queryKey = queryKeys.slate(leagueId, variables.date);
      queryClient.setQueryData<SlateResponse>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          games: current.games.map((game) =>
            game.gameId === writtenPick.gameId ? { ...game, myPick: writtenPick.selectedTeam } : game,
          ),
        };
      });
    },

    // VISIBLE, EXPLAINED REVERT — never a silent snap-back. Two
    // things happen, both required: the cache is rolled all the way
    // back to the true prior snapshot (not just "undo the optimistic
    // guess," which could still leave a wrong intermediate value if
    // something else changed the cache in between), AND a
    // `PickRejection` is recorded that persists until a screen
    // explicitly deals with it.
    onError: (error, variables, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previousSlate);
      }
      const revertedTo = context?.previousSlate?.games.find((g) => g.gameId === variables.gameId)?.myPick ?? null;
      setRejection({
        gameId: variables.gameId,
        attemptedSelectedTeam: variables.selectedTeam,
        revertedTo,
        reason: error,
      });
    },
  });

  return {
    writePick: mutation.mutate,
    writePickAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    /** The unacknowledged rejection, if any — a screen MUST render
     * something for this (per the brief, never nothing/a vanishing
     * toast) and call `dismissRejection()` once the user has actually
     * seen it. */
    rejection,
    dismissRejection: () => setRejection(null),
  };
}
