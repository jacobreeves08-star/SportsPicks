import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateGlobalNotifications, updateLeagueNotifications } from "../api/endpoints.js";
import type { UserProfile } from "../api/types.js";
import { queryKeys } from "../query/keys.js";

/**
 * The global toggle — optimistic against the `queryKeys.me()` cache
 * (the same cache `useMe()` reads), following
 * `mutations/use-pick-mutation.ts`'s established revert-on-rejection
 * convention at a much smaller scale: flip the cached value
 * immediately, roll back to the exact prior snapshot on rejection.
 */
export function useUpdateGlobalNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) => updateGlobalNotifications(enabled),
    onMutate: (enabled) => {
      void queryClient.cancelQueries({ queryKey: queryKeys.me() });
      const previous = queryClient.getQueryData<UserProfile>(queryKeys.me());
      if (previous) {
        queryClient.setQueryData<UserProfile>(queryKeys.me(), { ...previous, notificationsEnabled: enabled });
      }
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.me(), context.previous);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<UserProfile>(queryKeys.me(), (current) =>
        current ? { ...current, notificationsEnabled: result.notificationsEnabled } : current,
      );
    },
  });
}

/**
 * The per-league toggle — deliberately NOT optimistic against a query
 * cache, because there is no read endpoint for this value to cache
 * (docs/app-shell.md — a real, flagged gap: the members LIST endpoint
 * is the wrong place to expose it, a correctly-scoped "my own
 * membership" read doesn't exist yet). `PreferencesForm` owns its own
 * local per-league toggle state and reverts it directly on rejection
 * via this mutation's per-call `onError`, the same revert discipline
 * at a smaller scale.
 */
export function useUpdateLeagueNotifications() {
  return useMutation({
    mutationFn: ({ leagueId, memberId, enabled }: { leagueId: string; memberId: string; enabled: boolean }) =>
      updateLeagueNotifications(leagueId, memberId, enabled),
  });
}
