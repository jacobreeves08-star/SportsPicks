/**
 * A small, static, word-boundary blocklist — not exhaustive, no ML, no
 * third-party moderation service. Matches this app's consistent
 * zero-external-dependency-unless-necessary posture (ESPN over a paid
 * provider, Argon2id over a hosted auth service), but this one is a
 * genuine known limitation, not just a cost tradeoff: a static list can
 * never catch everything, and deliberately doesn't attempt to list
 * slurs/hate speech here. If real abuse shows up in league names, the
 * right fix is a real moderation API (e.g. a provider's text-moderation
 * endpoint), not a bigger hand-maintained list. Applied to league
 * `name` only (create + rename) — see docs/leagues-and-membership.md.
 */
const BLOCKLIST = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "piss"];

const BLOCKLIST_PATTERN = new RegExp(`\\b(${BLOCKLIST.join("|")})\\b`, "i");

export function containsDisallowedContent(text: string): boolean {
  return BLOCKLIST_PATTERN.test(text);
}
