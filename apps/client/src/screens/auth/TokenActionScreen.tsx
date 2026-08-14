import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError } from "../../api/errors.js";
import { verifyEmail, verifyEmailChange } from "../../api/endpoints.js";
import { Spinner, Stack, Text } from "../../design-system/index.js";
import { StandaloneLayout } from "../StandaloneLayout.js";
import authFormStyles from "../StandaloneForm.module.css";

export type TokenAction = "verify-email" | "verify-email-change";

function callAction(action: TokenAction, token: string): Promise<{ message: string }> {
  return action === "verify-email" ? verifyEmail(token) : verifyEmailChange(token);
}

export interface TokenActionScreenProps {
  action: TokenAction;
  token: string | undefined;
  title: string;
  missingTokenMessage: string;
  pendingLabel: string;
}

/**
 * Shared shape for both one-shot, single-use-token GET landings
 * (`/verify-email`, `/verify-email-change`) — same request, same
 * success/error rendering, differing only in which endpoint and copy
 * apply. Deliberately NOT a TanStack Query `useQuery`: the underlying
 * GET has a real server-side side effect (it consumes a single-use
 * token — see apps/api/src/routes/auth.routes.ts), so a query
 * library's own retry/refetch/StrictMode-remount behavior is a risk
 * worth avoiding outright rather than trusting de-duplication to
 * cover it. The `firedRef` guard below is the actual correctness
 * mechanism: the request fires at most once per mount, full stop,
 * independent of how many times the effect itself re-runs.
 */
export function TokenActionScreen({ action, token, title, missingTokenMessage, pendingLabel }: TokenActionScreenProps) {
  const firedRef = useRef(false);
  const [state, setState] = useState<
    | { status: "missing" }
    | { status: "pending" }
    | { status: "success"; message: string }
    | { status: "error"; message: string }
  >(() => (token ? { status: "pending" } : { status: "missing" }));

  useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true;
    callAction(action, token)
      .then((result) => setState({ status: "success", message: result.message }))
      .catch((error: unknown) => {
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
        });
      });
  }, [action, token]);

  return (
    <StandaloneLayout title={title}>
      {state.status === "missing" ? (
        <Text as="p" color="error" role="alert">
          {missingTokenMessage}
        </Text>
      ) : state.status === "pending" ? (
        <Stack align="center">
          <Spinner label={pendingLabel} />
        </Stack>
      ) : (
        <Stack gap={3}>
          <Text as="p" color={state.status === "error" ? "error" : "default"} role={state.status === "error" ? "alert" : "status"}>
            {state.message}
          </Text>
          <Link to="/login" className={authFormStyles.link}>
            Go to login
          </Link>
        </Stack>
      )}
    </StandaloneLayout>
  );
}
