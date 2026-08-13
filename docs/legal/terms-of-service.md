# Terms of Service

**DRAFT — not reviewed by counsel. Do not publish, present to users, or rely on this document as a real Terms of Service until a licensed attorney has reviewed it, and until the flagged items below are resolved.** This draft exists so the actual system behavior is documented in the shape a real Terms of Service needs, and so the two open legal questions below are recorded, not silently assumed away.

*Last drafted: this document has no effective date, because it has not been reviewed or published.*

## 1. What this is

Sports Pick'em ("the Service") is a free pick'em game: members of a private league pick winners for a slate of games each day, and standings are computed from correct picks. **There is no entry fee, no buy-in, and no cash or cash-equivalent prize of any kind.** See item 7 below for the one thing this draft explicitly does not resolve about that fact.

## 2. Eligibility

**Product default, not a legal determination:** use of the Service is intended to be limited to individuals 18 years of age or older. **As of this draft, age is not actually collected or verified anywhere in the signup flow** — there is no age-confirmation field in the account creation API today. This is a real gap between this draft and the current system, not an oversight in the writing: an `ageConfirmed` self-attestation checkbox at signup, paired with a `terms_accepted_at` timestamp recorded on the account at the moment of consent, is the intended mechanism once a frontend exists to collect it (self-attestation, not date-of-birth, to avoid collecting more personal data than the product actually needs — consistent with the account model's existing privacy-minimalism, see the Privacy Policy). **This gap must be closed before the Service is opened beyond the closed beta described in `docs/notifications.md`/`docs/analytics.md`.**

## 3. Accounts

You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Report any unauthorized use immediately. Account passwords are stored using a modern, salted hash (Argon2id) — the Service never has access to your plaintext password and cannot recover it for you; a forgotten password can only be reset, not retrieved.

## 4. Leagues and conduct

Leagues are created by a commissioner and joined via an invite code, per `docs/leagues-and-membership.md`. League and member content (league names, display names) is filtered against a basic disallowed-content list at creation/edit time, but this is not a substitute for reporting genuinely abusive behavior — a member can report another member for review by the league commissioner.

You agree not to:
- Attempt to circumvent rate limits, automated signup protections, or any other technical control described in `docs/rate-limiting-and-caching.md`.
- Use the Service to harass, abuse, or impersonate another person.
- Attempt to access another user's account or another league's data without authorization.

## 5. Picks, scoring, and data accuracy

Game schedules and results are sourced from a third-party sports data provider (see item 8 below for the unresolved licensing question about this source). **The Service does not guarantee the accuracy, completeness, or timeliness of any schedule, score, or result.** Scores and standings may be corrected after the fact if the underlying data provider issues a revision — see `docs/scoring-and-standings.md`'s result-correction mechanism — and such a correction can change a member's recorded win/loss for a game after the fact. This is an accepted, disclosed limitation of relying on a third-party data source, not a promise that results are final the moment they first appear.

## 6. No gambling, no wagering — **flagged, not resolved**

The Service has no entry fee, no buy-in, and no prize with monetary value. **Whether a free, no-buy-in, no-cash-prize pick'em game of this shape is nonetheless subject to gambling or contest regulation in any specific U.S. state or other jurisdiction has not been assessed by a lawyer, and this draft does not attempt to answer that question.** This is a real open item, not boilerplate: per explicit instruction from the product owner during this epic's development, this question is being flagged for legal review rather than guessed at. **If a paid tier, buy-in, or cash prize is ever considered for this product, that specific question must be answered in writing by a lawyer before it is built** — the current no-buy-in design is not, on its own, evidence that a paid version would also be fine.

## 7. Sports data, team names, and marks — **flagged, not resolved**

The Service displays real team names as part of showing game schedules and results, sourced from an undocumented, unauthenticated ESPN endpoint (`docs/adr/0003-sports-data-pipeline.md`) that has **no license, no contract, and no terms of use governing this app's access to it.** Whether displaying team names sourced this way, or the underlying data-access method itself, is permitted has not been confirmed with ESPN, the applicable sports leagues, or a lawyer. This is restated here verbatim from the engineering ADR because it belongs in this document too: **nothing about this draft, or about the product working today, implies that this access or this display of team names has been legally cleared.**

## 8. Termination and account deletion

You may delete your account at any time; deletion begins a grace period during which the request can be reversed by logging back in, after which your account is permanently anonymized (not deleted outright, to preserve the integrity of historical standings for other league members) — see the Privacy Policy and `docs/account-anonymization.md` for the complete, authoritative technical description of exactly what happens to your data. The Service may suspend or terminate an account for violating item 4 above.

## 9. Disclaimers and limitation of liability

The Service is provided "as is," without warranty of any kind. To the maximum extent permitted by law, the Service and its operator are not liable for any indirect, incidental, or consequential damages arising from use of the Service, including inaccuracies in third-party sports data (item 5). **This section is placeholder legal boilerplate and must be replaced with attorney-drafted language before publication.**

## 10. Governing law and dispute resolution — **placeholder**

**This section intentionally left as a placeholder pending jurisdiction-specific legal input.** No governing law, venue, or arbitration clause is specified in this draft.

## 11. Changes to these terms

The Service may update these terms; material changes will be communicated through the account's associated email address (subject to the notification preferences described in `docs/notifications.md`).

## 12. Contact

**Placeholder — a real contact method (support email or equivalent) must be added here before publication.**
