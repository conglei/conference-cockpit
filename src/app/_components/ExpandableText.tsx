"use client";

import { useState } from "react";

/**
 * A long paragraph that clamps to a few lines and expands on click. Only shows
 * the toggle when the text is actually long enough to be clamped, so short
 * descriptions render as plain text with no affordance.
 */
export default function ExpandableText({
  text,
  className,
  threshold = 240,
}: {
  text: string;
  className?: string;
  threshold?: number;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > threshold;

  return (
    <div className="expandable">
      <p className={className} data-clamp={long && !open ? "true" : undefined}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className="expandable-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
