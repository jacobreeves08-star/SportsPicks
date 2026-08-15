import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_LINK_LABEL } from "./build-trivia-share-text.js";
import { TriviaShareButton } from "./TriviaShareButton.js";

const RESULTS = [true, true, true, false, false];
const URL = "https://pickem.example/college-quiz";

const originalShare = (navigator as { share?: unknown }).share;

/** jsdom's `Blob` has no `.text()`, and Node's `Response` doesn't
 * recognize it either (it stringifies to "[object Blob]") — FileReader
 * is the one reader that speaks jsdom's own Blob. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  if (originalShare === undefined) {
    Reflect.deleteProperty(navigator, "share");
  } else {
    Object.defineProperty(navigator, "share", { value: originalShare, configurable: true });
  }
  Reflect.deleteProperty(globalThis, "ClipboardItem");
  vi.restoreAllMocks();
});

describe("TriviaShareButton — native share (a phone)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { value: vi.fn().mockResolvedValue(undefined), configurable: true });
  });

  it("passes the URL as its own field, so the messaging app can unfurl it into a card", () => {
    render(<TriviaShareButton puzzleNumber={15} results={RESULTS} url={URL} />);
    fireEvent.click(screen.getByRole("button", { name: "Share result" }));

    expect(navigator.share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Pick'em College Quiz", url: URL }),
    );
    // Not pasted onto the end of the text — that's what would cost the
    // preview card.
    const { text } = vi.mocked(navigator.share).mock.calls[0]![0] as { text: string };
    expect(text).not.toContain(URL);
  });

  it("swallows a user-canceled share (AbortError) without throwing", () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new DOMException("canceled", "AbortError")),
      configurable: true,
    });
    render(<TriviaShareButton puzzleNumber={15} results={RESULTS} url={URL} />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: /copy result|share result/i }))).not.toThrow();
  });
});

describe("TriviaShareButton — clipboard fallback (a desktop)", () => {
  beforeEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  it("writes a rich-text flavor whose link is marketing copy, not an address", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText: vi.fn() }, configurable: true });
    const items: Record<string, Blob>[] = [];
    Object.defineProperty(globalThis, "ClipboardItem", {
      value: class {
        constructor(payload: Record<string, Blob>) {
          items.push(payload);
        }
      },
      configurable: true,
    });

    render(<TriviaShareButton puzzleNumber={15} results={RESULTS} url={URL} />);
    fireEvent.click(screen.getByRole("button", { name: /copy result/i }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);

    const payload = items[0]!;
    expect(Object.keys(payload).sort()).toEqual(["text/html", "text/plain"]);
    expect(await readBlob(payload["text/html"]!)).toContain(`<a href="${URL}">${SHARE_LINK_LABEL}</a>`);
    // The plain flavor still spells the URL out — a text message has no
    // other way to carry a link.
    expect(await readBlob(payload["text/plain"]!)).toContain(URL);
  });

  it("falls back to plain text where ClipboardItem doesn't exist", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<TriviaShareButton puzzleNumber={15} results={RESULTS} url={URL} />);
    fireEvent.click(screen.getByRole("button", { name: /copy result/i }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(URL));
  });

  it("stays silent when the clipboard is denied, and does NOT claim it copied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    render(<TriviaShareButton puzzleNumber={15} results={RESULTS} url={URL} />);
    fireEvent.click(screen.getByRole("button", { name: /copy result/i }));

    expect(await screen.findByText("Copy result")).toBeInTheDocument();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });
});
