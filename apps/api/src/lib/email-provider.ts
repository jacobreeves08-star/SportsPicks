import { DateTime } from "luxon";
import { Resend } from "resend";
import { env } from "./env.js";
import { logger } from "./logger.js";

/** Formats an absolute instant in the RECIPIENT's own timezone (JAC-43-48)
 * — the send trigger itself is anchored to the instant, timezone-
 * independent; this is purely how the email's content is presented. */
function formatInZone(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).toFormat("cccc, LLL d 'at' h:mm a ZZZZ");
}

export interface PickReminderGame {
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
}

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
  /** JAC-43 — sent before a league's first lock of the day, only to
   * members with >=1 unpicked game (never to someone who's already
   * picked everything). `timezone` is the RECIPIENT's own, for display
   * only — see docs/notifications.md. */
  sendPickReminderEmail(
    to: string,
    params: { leagueName: string; unpickedGames: PickReminderGame[]; firstLockAt: Date; timezone: string },
  ): Promise<void>;
  /** JAC-43 — sent once a league's day is fully settled: the member's
   * record for the day, rank, and movement since the prior period. */
  sendResultsSummaryEmail(
    to: string,
    params: { leagueName: string; wins: number; losses: number; rank: number; rankChange: number | null },
  ): Promise<void>;
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

  async sendPickReminderEmail(
    to: string,
    params: { leagueName: string; unpickedGames: PickReminderGame[]; firstLockAt: Date; timezone: string },
  ): Promise<void> {
    logger.info({ email: "pick_reminder", to, ...params }, "mock email: pick reminder");
  }

  async sendResultsSummaryEmail(
    to: string,
    params: { leagueName: string; wins: number; losses: number; rank: number; rankChange: number | null },
  ): Promise<void> {
    logger.info({ email: "results_summary", to, ...params }, "mock email: results summary");
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

  async sendPickReminderEmail(
    to: string,
    params: { leagueName: string; unpickedGames: PickReminderGame[]; firstLockAt: Date; timezone: string },
  ): Promise<void> {
    const { leagueName, unpickedGames, firstLockAt, timezone } = params;
    const gamesList = unpickedGames
      .map((g) => `<li>${g.homeTeam} vs ${g.awayTeam} — locks ${formatInZone(g.startsAt, timezone)}</li>`)
      .join("");
    await this.send(
      to,
      `${leagueName}: picks close soon`,
      `<p>The first game in ${leagueName} locks ${formatInZone(firstLockAt, timezone)}. You still have ${unpickedGames.length} pick${unpickedGames.length === 1 ? "" : "s"} to make:</p><ul>${gamesList}</ul>`,
    );
  }

  async sendResultsSummaryEmail(
    to: string,
    params: { leagueName: string; wins: number; losses: number; rank: number; rankChange: number | null },
  ): Promise<void> {
    const { leagueName, wins, losses, rank, rankChange } = params;
    const movement =
      rankChange === null || rankChange === 0
        ? "no change"
        : rankChange > 0
          ? `up ${rankChange}`
          : `down ${Math.abs(rankChange)}`;
    await this.send(
      to,
      `${leagueName}: today's results`,
      `<p>Today in ${leagueName}: <strong>${wins}-${losses}</strong>. You're currently rank <strong>${rank}</strong> (${movement}).</p>`,
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
