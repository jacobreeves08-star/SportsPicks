import { Resend } from "resend";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Abstraction over the transactional email provider. `mock` is used in
 * dev/test so local work and CI never send real email or need a Resend
 * account; `live` (Resend) is only wired up in staging/prod. Mirrors the
 * mock/live split in sports-provider.ts.
 */
export interface EmailProvider {
  sendVerificationEmail(to: string, link: string): Promise<void>;
  sendEmailChangeVerification(to: string, link: string): Promise<void>;
  sendPasswordResetEmail(to: string, link: string): Promise<void>;
  /** Sent to the EXISTING account when someone tries to sign up with its
   * email — never reveals to the signer-upper that the account exists. */
  sendDuplicateSignupNotice(to: string): Promise<void>;
}

class MockEmailProvider implements EmailProvider {
  async sendVerificationEmail(to: string, link: string): Promise<void> {
    logger.info({ email: "verification", to, link }, "mock email: verification link");
  }

  async sendEmailChangeVerification(to: string, link: string): Promise<void> {
    logger.info({ email: "email_change", to, link }, "mock email: email-change verification link");
  }

  async sendPasswordResetEmail(to: string, link: string): Promise<void> {
    logger.info({ email: "password_reset", to, link }, "mock email: password reset link");
  }

  async sendDuplicateSignupNotice(to: string): Promise<void> {
    logger.info({ email: "duplicate_signup", to }, "mock email: duplicate signup notice");
  }
}

class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly fromAddress: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendVerificationEmail(to: string, link: string): Promise<void> {
    await this.send(to, "Verify your email", `<p>Confirm your email: <a href="${link}">${link}</a></p>`);
  }

  async sendEmailChangeVerification(to: string, link: string): Promise<void> {
    await this.send(
      to,
      "Confirm your new email",
      `<p>Confirm your new email address: <a href="${link}">${link}</a></p>`,
    );
  }

  async sendPasswordResetEmail(to: string, link: string): Promise<void> {
    await this.send(
      to,
      "Reset your password",
      `<p>Reset your password: <a href="${link}">${link}</a></p><p>If you didn't request this, ignore this email.</p>`,
    );
  }

  async sendDuplicateSignupNotice(to: string): Promise<void> {
    await this.send(
      to,
      "Someone tried to sign up with your email",
      `<p>Someone just tried to create an account using this email address, which already has one. If this was you, log in instead. If not, you can safely ignore this email.</p>`,
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.fromAddress, to, subject, html });
    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }
  }
}

/**
 * Accepts an optional override purely so tests can exercise both
 * branches without fighting env.ts's eager-throw-at-import design.
 */
export function createEmailProvider(provider: "mock" | "resend" = env.EMAIL_PROVIDER): EmailProvider {
  if (provider === "mock") {
    return new MockEmailProvider();
  }
  return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM_ADDRESS!);
}
