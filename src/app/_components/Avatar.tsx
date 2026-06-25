"use client";

import { useState } from "react";

/**
 * Round avatar that degrades to initials. Many `photoUrl`s are LinkedIn CDN
 * links that expire / 403; on load error we swap to the initials chip rather
 * than show a broken-image glyph.
 */
export default function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const cls = `avatar${size >= 64 ? " avatar-lg" : ""}`;

  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className={cls}
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={`${cls} avatar-fallback`} aria-hidden="true">
      {initials}
    </span>
  );
}
