import { useState } from "react";
import { Stack, Text } from "../design-system/index.js";
import { buildTriviaShareHtml, buildTriviaShareText, type TriviaShareInput } from "./build-trivia-share-text.js";
import styles from "./TriviaShareButton.module.css";

export interface TriviaShareButtonProps extends TriviaShareInput {
  /** Where a friend should land to play the same quiz. Defaults to the
   * quiz's own public URL on this origin — deliberately the PUBLIC
   * route, since the whole point is that the recipient can play
   * without an account. */
  url?: string;
}

/**
 * Share a finished round. Same two-path structure as
 * `app-shell/ShareResultsButton` (native share sheet when the browser
 * has one, copy-to-clipboard when it doesn't), and the same reason
 * for it: on a phone, `navigator.share` covers text message, every
 * social app, and email in one tap without this component needing to
 * know which apps are installed.
 *
 * Which UI renders is decided once, from `navigator.share`'s presence
 * at render time rather than inside the click handler, so a test can
 * mock or delete that global to exercise either path.
 */
export function TriviaShareButton({ puzzleNumber, results, url }: TriviaShareButtonProps) {
  const text = buildTriviaShareText({ puzzleNumber, results });
  const shareUrl = url ?? (typeof window !== "undefined" ? `${window.location.origin}/college-quiz` : "");
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (canNativeShare) {
    return (
      <button
        type="button"
        className={styles.buttonPrimary}
        onClick={() => {
          // `url` stays its own field rather than being pasted onto the
          // end of `text`: that's what lets Messages/WhatsApp/Slack
          // recognize a link to unfurl, and turn it into a titled
          // preview card built from index.html's Open Graph tags
          // instead of a bare address.
          //
          // Dismissing the sheet rejects with an AbortError — a user
          // changing their mind is not a failure to report.
          navigator.share({ title: "Pick'em College Quiz", text, url: shareUrl }).catch(() => {});
        }}
      >
        Share result
      </button>
    );
  }

  return <ShareFallback input={{ puzzleNumber, results, url: shareUrl }} />;
}

function ShareFallback({ input }: { input: TriviaShareInput & { url: string } }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    // Two flavors on one clipboard write. A rich-text destination
    // (Slack, Gmail, Notes, a doc) takes the HTML and shows a clickable
    // "Play today's quiz →" with no visible URL; a plain-text one
    // (SMS, a terminal, a code editor) takes the text/plain flavor,
    // where a bare URL is the only thing a link CAN be.
    const html = buildTriviaShareHtml(input);
    const plain = `${buildTriviaShareText(input)}\n${input.url}`;

    try {
      if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        // Older Safari/Firefox, and jsdom. Plain text is the flavor
        // that matters most (it's what a text message gets anyway), so
        // losing the anchor here costs the paste nothing it needed.
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
    } catch {
      // Clipboard permission denied or unavailable. The text is on
      // screen in the result card either way, so it can still be
      // selected and copied by hand — nothing is lost silently.
    }
  }

  return (
    <Stack direction="row" gap={2}>
      <button type="button" className={styles.buttonPrimary} onClick={() => void handleCopy()}>
        <Text size="sm" weight="bold">
          {copied ? "Copied!" : "Copy result"}
        </Text>
      </button>
    </Stack>
  );
}
