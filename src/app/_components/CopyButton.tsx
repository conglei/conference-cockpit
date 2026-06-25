"use client";

import { useState } from "react";

/** Copy-to-clipboard for a draft opener. Draft only — the app never sends. */
export default function CopyButton({ text, label = "Copy opener" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
