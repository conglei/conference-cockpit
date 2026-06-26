"use client";

import { useState } from "react";

/**
 * Resolve a stored `photoUrl` to a loadable image URL. Speaker photos are stored
 * as site-relative paths (e.g. `/wf26/speakers/by-id/spk_ari_morcos.jpg`) served
 * from `www.ai.engineer` — note the `www`: the bare apex 308-redirects and
 * browsers won't follow that for an <img>. Absolute URLs pass through.
 */
function resolvePhoto(src: string | null): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src.replace(/^https?:\/\/ai\.engineer/, "https://www.ai.engineer");
  if (src.startsWith("/")) return `https://www.ai.engineer${src}`;
  return src;
}

/**
 * Round avatar that degrades to initials. Photos can 404 / expire; on load error
 * we swap to the initials chip rather than show a broken-image glyph.
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
  const resolved = resolvePhoto(src);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const cls = `avatar${size >= 64 ? " avatar-lg" : ""}`;

  if (resolved && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className={cls}
        src={resolved}
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
