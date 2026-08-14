import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelAccountDeletion,
  changePassword,
  requestAccountDeletion,
  requestEmailChange,
  updateMe,
} from "../../api/endpoints.js";
import { queryKeys } from "../../query/keys.js";

/** Display name / avatar / timezone — the response is the caller's
 * full updated profile (plus an optional `warning`, surfaced by the
 * caller directly from `mutation.data`), so the `me` cache is written
 * straight from it rather than invalidated-and-refetched. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateMe>[0]) => updateMe(body),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.me(), profile);
    },
  });
}

/** Requests a new email — the account's `email` doesn't change until
 * the new address is verified (server sets `pendingEmail` instead), so
 * the `me` cache is invalidated to pick that up rather than guessed at
 * optimistically. */
export function useRequestEmailChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newEmail: string) => requestEmailChange(newEmail),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: Parameters<typeof changePassword>[0]) => changePassword(body),
  });
}

/** Deliberately does NOT invalidate the `me` cache on success —
 * `POST /me/deletion-request` revokes every session for this account,
 * INCLUDING the one making this request (users.routes.ts), so an
 * immediate refetch would 401 and bounce the user to /login before
 * they can read the confirmation. The caller renders the confirmation
 * straight from `mutation.data` instead. */
export function useRequestAccountDeletion() {
  return useMutation({ mutationFn: () => requestAccountDeletion() });
}

/** Unlike deletion-request, this does NOT revoke the current session
 * (only reachable by logging back in during the grace period in the
 * first place — see users.routes.ts), so a normal invalidate is safe
 * and picks up the cleared `deletionRequestedAt`/`scheduledDeletionAt`. */
export function useCancelAccountDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cancelAccountDeletion(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });
}
