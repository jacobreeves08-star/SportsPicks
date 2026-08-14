import { useState } from "react";
import type { ResultsDigestEntry } from "../api/types.js";
import { Stack, Text } from "../design-system/index.js";
import { buildShareText } from "./build-share-text.js";
import styles from "./ShareResultsButton.module.css";

export interface ShareResultsButtonProps {
  entries: ResultsDigestEntry[];
}

/**
 * The native Web Share API as the primary path (one tap opens the
 * device's real share sheet — text/social/email/SMS all covered at
 * once on a phone), with Copy-text/`mailto:` as the desktop fallback —
 * confirmed with the user directly, and confirmed via a full-codebase
 * search that no share code existed anywhere in this client before
 * this. Which UI renders is decided once, from `navigator.share`'s
 * presence at render time (not inside a click handler), so a test can
 * simply mock/delete that global to exercise either path.
 */
export function ShareResultsButton({ entries }: ShareResultsButtonProps) {
  const text = buildShareText(entries);
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (canNativeShare) {
    return (
      <button
        type="button"
        className={styles.buttonPrimary}
        onClick={() => {
          // A user dismissing the share sheet rejects with an
          // AbortError — not a real failure, nothing to surface.
          navigator.share({ title: "Pick'em results", text, url }).catch(() => {});
        }}
      >
        Share
      </button>
    );
  }

  return <ShareFallback text={text} url={url} />;
}

function ShareFallback({ text, url }: { text: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const fullText = `${text} ${url}`;
  const mailtoHref = `mailto:?subject=${encodeURIComponent("My Pick'em results")}&body=${encodeURIComponent(fullText)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
    } catch {
      // Clipboard permission denied or unavailable — the "Email"
      // fallback right next to this button still works either way.
    }
  }

  return (
    <Stack direction="row" gap={2}>
      <button type="button" className={styles.button} onClick={() => void handleCopy()}>
        <Text size="sm" weight="medium">
          {copied ? "Copied!" : "Copy text"}
        </Text>
      </button>
      <a href={mailtoHref} className={styles.link}>
        <span className={styles.button}>
          <Text size="sm" weight="medium">
            Email
          </Text>
        </span>
      </a>
    </Stack>
  );
}
