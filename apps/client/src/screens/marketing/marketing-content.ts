import { SPORT_OPTIONS } from "../../leagues/sports.js";

/**
 * Every word of marketing copy on the logged-out front door, in one
 * place — the sections themselves are pure layout over these arrays.
 * Kept as data rather than inline JSX for the same reason the sport
 * list isn't hand-typed below: copy on a marketing page gets edited far
 * more often than the layout around it, and a non-layout edit shouldn't
 * mean touching a component.
 *
 * Everything here is a claim about behavior this repo actually
 * implements — the numbers are derived or cited, not invented:
 *
 * - sport count: `SPORT_OPTIONS.length`, computed below, so adding a
 *   13th sport updates the headline stat by itself.
 * - "one point per correct winner, no spreads": docs/picks-and-locking.md.
 * - "scores refresh every 5 minutes": `score-poll`'s every-five-minutes
 *   cron schedule, docs/sports-pipeline.md.
 * - postponed/cancelled voided for everyone: docs/scoring-and-standings.md.
 * - locking never trusts the client clock: docs/picks-and-locking.md's
 *   "Lock enforcement" section.
 * - 8-character invite code: `apps/api/src/lib/invite-code.ts`.
 *
 * There is deliberately NO fabricated social proof here (no user
 * counts, no testimonials, no "trusted by" logos) — none of it would be
 * true, and a landing page that opens with a made-up number is the one
 * thing a visitor can actually catch you on.
 */

export const SPORT_COUNT = SPORT_OPTIONS.length;

/** The sports grid renders the real, server-validated list — the same
 * one `CreateLeagueScreen` offers — so the page can never advertise a
 * sport a league can't actually be created with. */
export const MARKETING_SPORTS = SPORT_OPTIONS;

export interface MarketingStat {
  value: string;
  label: string;
}

export const MARKETING_STATS: MarketingStat[] = [
  { value: String(SPORT_COUNT), label: "Sports to mix into one league" },
  { value: "1 pt", label: "Per correct winner — no spreads, no juice" },
  { value: "5 min", label: "How often live scores refresh" },
  { value: "$0", label: "To play. No wagers, no entry fees" },
];

export interface MarketingStep {
  title: string;
  body: string;
}

export const MARKETING_STEPS: MarketingStep[] = [
  {
    title: "Start a league",
    body: "Name it, pick which sports count, set how far ahead picks open. You're the commissioner.",
  },
  {
    title: "Send one code",
    body: "Every league gets an eight-character invite code. Drop it in the group chat — that's the whole onboarding.",
  },
  {
    title: "Pick, then watch",
    body: "Tap a winner before kickoff. Scores, grading, and standings take care of themselves from there.",
  },
];

/** `icon` is a key into `FEATURE_ICONS` in `MarketingSections.tsx` —
 * a plain string here so this module stays free of JSX and can be
 * imported by anything (a test, a future sitemap generator). */
export interface MarketingFeature {
  icon: "lock" | "chart" | "calendarOff" | "clock" | "user" | "cloudOff";
  title: string;
  body: string;
}

export const MARKETING_FEATURES: MarketingFeature[] = [
  {
    icon: "lock",
    title: "Locks at kickoff. Really.",
    body: "The lock is enforced on the server against the game's own start time — never your device's clock. A tab left open since this morning gets the same answer as a fresh one.",
  },
  {
    icon: "chart",
    title: "Standings that keep themselves",
    body: "Today, this week, all season, with real tiebreakers underneath. Nobody in your league has to run a spreadsheet.",
  },
  {
    icon: "calendarOff",
    title: "A rainout is nobody's loss",
    body: "Postponed and cancelled games are voided for everyone — never counted against you, never quietly scored as a miss.",
  },
  {
    icon: "clock",
    title: "Nudges before it's too late",
    body: "An email reminder while your picks are still open, and a results digest once the day is graded. Both are per-league switches you own.",
  },
  {
    icon: "user",
    title: "Head-to-head, game by game",
    body: "See exactly where you gained ground and where the whole league got it wrong — not just a final number.",
  },
  {
    icon: "cloudOff",
    title: "Built for a bar, not a desk",
    body: "One-handed on a phone, thirty seconds before kickoff. Picks made on bad wifi queue up and send themselves.",
  },
];

export interface MarketingFaq {
  question: string;
  answer: string;
}

export const MARKETING_FAQS: MarketingFaq[] = [
  {
    question: "Do I need to understand spreads?",
    answer:
      "No. Pick the side you think wins, get a point if you're right. No spreads, no confidence weighting, no math.",
  },
  {
    question: "What happens if a game gets postponed?",
    answer:
      "Nothing bad. The pick is voided for everyone in the league, so it counts as neither a win nor a loss — and if the game gets a new date, your pick carries over to it.",
  },
  {
    question: "Can one league cover more than one sport?",
    answer: `Yes — that's the point. Any mix of the ${SPORT_COUNT} sports scores into a single record and a single standings table.`,
  },
  {
    question: "Is there money in this?",
    answer:
      "None. There's no wagering, no entry fee, and nothing to deposit. It's a running argument with your friends, kept score of properly.",
  },
];
