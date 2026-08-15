import { useState } from "react";
import { Stack, Text } from "../design-system/index.js";
import { buildTriviaShareText, type TriviaShareInput } from "./build-trivia-share-text.js";
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
          // Dismissing the sheet rejects with an AbortError — a user
          // changing their mind is not a failure to report.
          navigator.share({ title: "Pick'em College Quiz", text, url: shareUrl }).catch(() => {});
        }}
      >
        Share result
      </button>
    );
  }

  return <ShareFallback text={text} url={shareUrl} />;
}

function ShareFallback({ text, url }: { text: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const fullText = `${text}\n${url}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
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
