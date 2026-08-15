import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarOffIcon,
  ChartIcon,
  ClockIcon,
  CloudOffIcon,
  LockIcon,
  Stack,
  Surface,
  Text,
  UserIcon,
} from "../../design-system/index.js";
import type { MarketingLoginAction } from "./MarketingHeader.js";
import {
  MARKETING_FAQS,
  MARKETING_FEATURES,
  MARKETING_SPORTS,
  MARKETING_STATS,
  MARKETING_STEPS,
  SPORT_COUNT,
  type MarketingFeature,
} from "./marketing-content.js";
import styles from "./Marketing.module.css";

/** `MarketingFeature.icon` is a plain string in `marketing-content.ts`
 * (which stays JSX-free so anything can import it) — this is the one
 * place those keys become real components. */
const FEATURE_ICONS: Record<MarketingFeature["icon"], (props: { size?: number }) => ReactNode> = {
  lock: LockIcon,
  chart: ChartIcon,
  calendarOff: CalendarOffIcon,
  clock: ClockIcon,
  user: UserIcon,
  cloudOff: CloudOffIcon,
};

export interface MarketingSectionsProps {
  /** Same pass-through as `MarketingHeader` — every signup link on the
   * page carries the visitor's original destination. */
  returnTo?: string;
  /** Same contract as `MarketingHeader`'s, for the closing CTA's
   * "I already have an account" — see `MarketingLoginAction`. */
  loginAction?: MarketingLoginAction;
}

/**
 * Everything below the hero on the logged-out front door: the proof
 * band, how it works, the sport list, the feature grid, the no-account
 * quiz callout, the FAQ, and the closing CTA.
 *
 * Split out of `auth/LoginScreen` rather than inlined there for two
 * reasons: the login screen's own job (a form, a mutation, a redirect)
 * shouldn't be buried under 250 lines of copy, and `PublicHomeScreen`
 * — the other logged-out front door, at `/` — can adopt these exact
 * sections without a copy-paste fork. The two pages are supposed to
 * read as one product; sharing the sections is what makes that true by
 * construction instead of by discipline.
 */
export function MarketingSections({ returnTo, loginAction = "route" }: MarketingSectionsProps) {
  return (
    <>
      {/* No heading of its own — this is a proof strip attached to the
          hero above it, not a section a visitor would navigate to. */}
      <div className={styles.band}>
        <div className={styles.section}>
          <ul className={styles.statGrid}>
            {MARKETING_STATS.map((stat) => (
              <li key={stat.label}>
                <span className={styles.statValue}>{stat.value}</span>
                <Text as="span" size="sm" color="dim" className={styles.statLabel}>
                  {stat.label}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section id="how-it-works" className={`${styles.section} ${styles.anchor}`} aria-labelledby="how-it-works-title">
        <Stack gap={6}>
          <Stack gap={3}>
            <span className={styles.eyebrow}>How it works</span>
            <h2 id="how-it-works-title" className={styles.sectionTitle}>
              Three steps, then it runs itself
            </h2>
            <Text as="p" color="dim" className={styles.sectionLead}>
              No draft night, no salary cap, no commissioner spreadsheet that someone forgets to update by week four.
            </Text>
          </Stack>

          {/* An <ol> because the order is the content — the numerals
              themselves are CSS counters (see Marketing.module.css), so
              the sequence isn't announced twice. */}
          <ol className={styles.stepGrid}>
            {MARKETING_STEPS.map((step) => (
              <Surface key={step.title} as="li" variant="raised" radius="lg" padding={5} className={styles.stepCard}>
                <Stack gap={2}>
                  <Text as="h3" className={styles.cardTitle}>
                    {step.title}
                  </Text>
                  <Text as="p" color="dim" size="sm">
                    {step.body}
                  </Text>
                </Stack>
              </Surface>
            ))}
          </ol>
        </Stack>
      </section>

      <div className={styles.band}>
        <section id="sports" className={`${styles.section} ${styles.anchor}`} aria-labelledby="sports-title">
          <Stack gap={6}>
            <Stack gap={3}>
              <span className={styles.eyebrow}>Sports</span>
              <h2 id="sports-title" className={styles.sectionTitle}>
                {SPORT_COUNT} sports. One standings table.
              </h2>
              <Text as="p" color="dim" className={styles.sectionLead}>
                Run a pure NFL league, or throw the Champions League, a major, and a UFC card into the same season.
                Everything scores into one record.
              </Text>
            </Stack>

            <ul className={styles.sportGrid}>
              {MARKETING_SPORTS.map((sport) => (
                <li key={sport.value} className={styles.sportChip}>
                  <span className={styles.sportTick} aria-hidden="true" />
                  {sport.label}
                </li>
              ))}
            </ul>
          </Stack>
        </section>
      </div>

      <section id="features" className={`${styles.section} ${styles.anchor}`} aria-labelledby="features-title">
        <Stack gap={6}>
          <Stack gap={3}>
            <span className={styles.eyebrow}>Why it holds up</span>
            <h2 id="features-title" className={styles.sectionTitle}>
              The boring parts, done right
            </h2>
            <Text as="p" color="dim" className={styles.sectionLead}>
              Anyone can put two team names next to a button. The arguments start over locks, rainouts, and whose
              record is actually right.
            </Text>
          </Stack>

          <ul className={styles.featureGrid}>
            {MARKETING_FEATURES.map((feature) => {
              const Icon = FEATURE_ICONS[feature.icon];
              return (
                <Surface
                  key={feature.title}
                  as="li"
                  variant="raised"
                  radius="lg"
                  padding={5}
                  className={styles.featureCard}
                >
                  <Stack gap={3}>
                    <span className={styles.featureIcon}>
                      <Icon size={22} />
                    </span>
                    <Text as="h3" className={styles.cardTitle}>
                      {feature.title}
                    </Text>
                    <Text as="p" color="dim" size="sm">
                      {feature.body}
                    </Text>
                  </Stack>
                </Surface>
              );
            })}
          </ul>
        </Stack>
      </section>

      <div className={styles.band}>
        <section className={styles.section} aria-labelledby="quiz-title">
          <Surface variant="raised" radius="lg" elevation={2} padding={6} className={styles.quizCard}>
            <div className={styles.quizLayout}>
              <Stack gap={2}>
                <span className={styles.eyebrow}>No account needed</span>
                <Text as="h2" id="quiz-title" className={styles.sectionTitle}>
                  Today&rsquo;s College Quiz
                </Text>
                <Text as="p" color="dim" className={styles.sectionLead}>
                  Five NFL players, five colleges each. Guess where each one went. New players every day, and you can
                  play it right now without signing up for anything.
                </Text>
              </Stack>
              <Link to="/college-quiz" className={`${styles.buttonPrimary} ${styles.buttonLarge}`}>
                Play today&rsquo;s quiz
              </Link>
            </div>
          </Surface>
        </section>
      </div>

      <section id="faq" className={`${styles.section} ${styles.anchor}`} aria-labelledby="faq-title">
        <Stack gap={6}>
          <Stack gap={3}>
            <span className={styles.eyebrow}>FAQ</span>
            <h2 id="faq-title" className={styles.sectionTitle}>
              Reasonable questions
            </h2>
          </Stack>

          <div className={styles.faqGrid}>
            {MARKETING_FAQS.map((faq) => (
              <Stack key={faq.question} gap={2}>
                <Text as="h3" className={styles.faqQuestion}>
                  {faq.question}
                </Text>
                <Text as="p" color="dim" size="sm">
                  {faq.answer}
                </Text>
              </Stack>
            ))}
          </div>
        </Stack>
      </section>

      <section className={styles.section} aria-labelledby="cta-title">
        <Surface variant="raised" radius="lg" elevation={2} padding={6} className={styles.ctaCard}>
          <Stack gap={4} align="center">
            <Text as="h2" id="cta-title" className={styles.ctaTitle}>
              Settle it on the scoreboard
            </Text>
            <Text as="p" color="dim" className={styles.sectionLead}>
              Free to start, one code to share, and the group chat has a standings table by kickoff.
            </Text>
            <div className={styles.ctaActions}>
              <Link
                to="/signup"
                search={{ returnTo }}
                className={`${styles.buttonPrimary} ${styles.buttonLarge}`}
              >
                Create your league
              </Link>
              {loginAction === "anchor" ? (
                <a href="#login" className={`${styles.buttonSecondary} ${styles.buttonLarge}`}>
                  I already have an account
                </a>
              ) : (
                <Link
                  to="/login"
                  search={{ returnTo }}
                  className={`${styles.buttonSecondary} ${styles.buttonLarge}`}
                >
                  I already have an account
                </Link>
              )}
            </div>
          </Stack>
        </Surface>
      </section>
    </>
  );
}
