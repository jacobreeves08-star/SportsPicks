import { useSearch } from "@tanstack/react-router";
import { TokenActionScreen } from "./TokenActionScreen.js";

export function VerifyEmailChangeScreen() {
  const { token } = useSearch({ from: "/verify-email-change" });
  return (
    <TokenActionScreen
      action="verify-email-change"
      token={token}
      title="Confirm your new email"
      missingTokenMessage="This link is missing a verification code — copy the full link from your email."
      pendingLabel="Confirming your new email"
    />
  );
}
