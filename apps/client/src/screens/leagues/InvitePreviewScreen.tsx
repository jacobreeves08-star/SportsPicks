import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { getAuthState } from "../../api/auth-store.js";
import { joinLeague, previewInvite } from "../../api/endpoints.js";
import { ErrorState, LoadingState, Stack, Text } from "../../design-system/index.js";
import { setCurrentLeagueId } from "../../leagues/current-league-store.js";
import { sportLabel } from "../../leagues/sports.js";
import { queryKeys } from "../../query/keys.js";
import { joinPath, slateIndexPath } from "../../routes/paths.js";
import { presentApiError } from "../present-api-error.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import formStyles from "../StandaloneForm.module.css";

/**
 * `joinRoute`'s (`/join/:inviteCode`) component — the deep-link
 * destination every real invite points at. Deliberately public: `GET
 * /leagues/preview` requires no auth as of this epic (a real backend
 * gap found and fixed building this screen — see
 * league-invites.routes.ts's own comment), because the brief is
 * explicit that a visitor with NO account yet must see this preview
 * BEFORE being asked to sign up. `POST /leagues/join` still requires
 * auth (it attaches a membership to a real userId), so a logged-out
 * visitor sees "sign up" / "log in" instead of a join button — both
 * links carry `returnTo` pointing back to this exact URL, so the
 * invite code is never lost across that detour (route-tree.tsx's
 * `signupRoute` comment has the full chain).
 */
export function InvitePreviewScreen() {
  const { inviteCode } = useParams({ from: "/join/$inviteCode" });
  const router = useRouter();
  const isAuthenticated = Boolean(getAuthState().accessToken);
  const returnTo = joinPath(inviteCode);

  const previewQuery = useQuery({
    queryKey: queryKeys.invitePreview(inviteCode),
    queryFn: () => previewInvite(inviteCode),
    retry: false,
  });

  const joinMutation = useMutation({
    mutationFn: () => joinLeague(inviteCode),
    onSuccess: (joined) => {
      setCurrentLeagueId(joined.leagueId);
      void router.navigate({ to: slateIndexPath(joined.leagueId) });
    },
  });

  if (previewQuery.isLoading) {
    return (
      <StandaloneLayout title="League invite">
        <LoadingState rows={2} label="Loading invite" />
      </StandaloneLayout>
    );
  }

  if (previewQuery.isError) {
    const { message } = presentApiError(previewQuery.error);
    return (
      <StandaloneLayout title="League invite">
        <ErrorState message={message ?? "This invite link isn't valid."} />
        <Link to="/join" className={formStyles.link}>
          Try a different code
        </Link>
      </StandaloneLayout>
    );
  }

  if (!previewQuery.data) {
    return (
      <StandaloneLayout title="League invite">
        <LoadingState rows={2} label="Loading invite" />
      </StandaloneLayout>
    );
  }

  const preview = previewQuery.data;
  const joinError = joinMutation.isError ? presentApiError(joinMutation.error) : undefined;

  return (
    <StandaloneLayout title={preview.name}>
      <Stack gap={3}>
        <Text as="p" color="dim">
          {preview.sports.map(sportLabel).join(", ")} · {preview.memberCount}{" "}
          {preview.memberCount === 1 ? "member" : "members"}
        </Text>

        {preview.alreadyMember ? (
          <Stack gap={3}>
            <Text as="p">You're already a member of this league.</Text>
            <Link to="/" className={formStyles.link}>
              Go to your leagues
            </Link>
          </Stack>
        ) : isAuthenticated ? (
          <Stack gap={3}>
            {joinError?.message ? (
              <Text as="p" color="error" role="alert">
                {joinError.message}
              </Text>
            ) : null}
            <button
              type="button"
              disabled={joinMutation.isPending}
              onClick={() => joinMutation.mutate()}
              className={`${formStyles.button} ${formStyles.buttonPrimary}`}
            >
              {joinMutation.isPending ? "Joining…" : "Join this league"}
            </button>
          </Stack>
        ) : (
          <Stack gap={2}>
            <Text as="p" size="sm" color="dim">
              Sign up or log in to join.
            </Text>
            <Link to="/signup" search={{ returnTo }} className={`${formStyles.button} ${formStyles.buttonPrimary}`}>
              Sign up to join
            </Link>
            <Link to="/login" search={{ returnTo }} className={formStyles.button}>
              Log in to join
            </Link>
          </Stack>
        )}
      </Stack>
    </StandaloneLayout>
  );
}
