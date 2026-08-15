/**
 * The one place a college-quiz result is turned into something
 * shareable — the native share sheet, the copy-to-clipboard fallback,
 * and any future surface all read from here, exactly like
 * `app-shell/build-share-text.ts` does for the results digest.
 *
 * **Spoiler-safe by construction.** No player names, no colleges, not
 * even which questions were which — just the day number and a row of
 * squares. That's deliberate: the whole point of everyone getting the
 * same five players (see the API's lib/trivia-puzzle.ts) is that a
 * friend can play the SAME quiz, and a share that named the players
 * would ruin the thing it's advertising.
 *
 * Two formats, because a share lands in two kinds of place:
 *
 *  - `buildTriviaShareText` — plain text, for SMS/iMessage and the
 *    share sheet. A text message has no rich text, so the link is a
 *    bare URL there and cannot be anything else; what makes it look
 *    like an invitation rather than a pasted address is the link
 *    preview card the recipient's app builds from the Open Graph tags
 *    in `index.html`.
 *  - `buildTriviaShareHtml` — the same message with a real anchor, for
 *    anywhere that accepts rich text (Slack, Gmail, Notes, a doc).
 *    There the URL is never shown at all: the link is marketing copy
 *    you can click.
 */

export interface TriviaShareInput {
  puzzleNumber: number;
  /** In question order, so the squares read left-to-right as the round
   * was actually played. */
  results: boolean[];
}

export interface TriviaShareLinkInput extends TriviaShareInput {
  /** Where a friend lands to play the same quiz — the public route. */
  url: string;
}

const HIT = "\u{1F7E9}"; // green square
const MISS = "\u{1F7E5}"; // red square — a miss should look like a
// miss. Red/green is the one pairing red-green color blindness can't
// separate, so the row is never the only statement of the result: the
// score is spelled out in numbers on the line directly above it, and
// that line is what the text leads with.

/** The anchor text in the rich-text version, and the promise the link
 * preview card makes. Written as an invitation, not a description: a
 * share has only done its job if the person receiving it plays. */
export const SHARE_LINK_LABEL = "Play today's quiz →";

/** Plain text: score, squares, and the pitch. The URL is appended by
 * the caller rather than baked in here, because the native share sheet
 * takes it as its own `url` field (which is what lets a messaging app
 * build a preview card from it) while the clipboard path has to spell
 * it out. */
export function buildTriviaShareText({ puzzleNumber, results }: TriviaShareInput): string {
  const correct = results.filter(Boolean).length;
  const squares = results.map((hit) => (hit ? HIT : MISS)).join("");
  return `Pick'em College Quiz #${puzzleNumber} — ${correct}/${results.length}\n${squares}\n\n${pitch(correct, results.length)}`;
}

/**
 * The invitation — addressed to whoever RECEIVES this, which is what
 * separates it from the result screen's verdict ladder (that one talks
 * to the player and sharpens as they do worse; this one has to make a
 * stranger want to play).
 *
 * Both ends are special-cased, because a dare has to be takeable: a
 * perfect round can only be matched, never beaten, and daring someone
 * to beat a shutout sets a bar nobody could be proud of clearing. The
 * score is stated in full on the line above either way, so the pitch
 * is free to stop repeating it.
 */
function pitch(correct: number, total: number): string {
  const lead = "Five NFL players, five colleges each";
  if (correct === total) return `${lead} — can you match ${correct}/${total}? \u{1F3C8}`;
  if (correct === 0) return `${lead} — it can only go up from here \u{1F3C8}`;
  return `${lead} — think you can beat ${correct}/${total}? \u{1F3C8}`;
}

/** The rich-text flavor: same message, but the link is `SHARE_LINK_LABEL`
 * rather than a visible address. */
export function buildTriviaShareHtml({ url, ...input }: TriviaShareLinkInput): string {
  const body = escapeHtml(buildTriviaShareText(input)).replace(/\n/g, "<br>");
  return `<p>${body}<br><a href="${escapeHtml(url)}">${escapeHtml(SHARE_LINK_LABEL)}</a></p>`;
}

/** Everything composed here is app-authored except the URL, which is
 * built from `window.location.origin` — but this output is written
 * to a system clipboard and pasted into other people's applications,
 * so it is escaped rather than trusted. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
