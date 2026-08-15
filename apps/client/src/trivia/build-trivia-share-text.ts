/**
 * The one place a college-quiz result is turned into shareable text —
 * the native share sheet, the copy-to-clipboard fallback, and any
 * future surface all read from here, exactly like
 * `app-shell/build-share-text.ts` does for the results digest.
 *
 * **Spoiler-safe by construction.** No player names, no colleges, not
 * even which questions were which — just the day number and a row of
 * squares. That's deliberate: the whole point of everyone getting the
 * same five players (see the API's lib/trivia-puzzle.ts) is that a
 * friend can play the SAME quiz, and a share that named the players
 * would ruin the thing it's advertising.
 */

export interface TriviaShareInput {
  puzzleNumber: number;
  /** In question order, so the squares read left-to-right as the round
   * was actually played. */
  results: boolean[];
}

const HIT = "\u{1F7E9}"; // green square
const MISS = "\u{2B1C}"; // white square — not red: this is a "how did
// you do" brag, and a wall of red reads as failure rather than fun.
// Also keeps the row legible for red-green color blindness, since the
// score is stated in numbers right beside it.

export function buildTriviaShareText({ puzzleNumber, results }: TriviaShareInput): string {
  const correct = results.filter(Boolean).length;
  const squares = results.map((hit) => (hit ? HIT : MISS)).join("");
  return `Pick'em College Quiz #${puzzleNumber} — ${correct}/${results.length}\n${squares}\n\nWhich college did they go to? 🏈`;
}
