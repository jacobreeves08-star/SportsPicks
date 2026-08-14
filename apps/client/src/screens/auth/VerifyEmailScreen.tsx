import { useSearch } from "@tanstack/react-router";
import { TokenActionScreen } from "./TokenActionScreen.js";

export function VerifyEmailScreen() {
  const { token } = useSearch({ from: "/verify-email" });
  return (
    <TokenActionScreen
      action="verify-email"
      token={token}
      title="Verify your email"
      missingTokenMessage="This link is missing a verification code — copy the full link from your email."
      pendingLabel="Verifying your email"
    />
  );
}
