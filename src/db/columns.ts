/**
 * Decoders for text columns. Several SQLite text columns in this schema hold
 * either a JSON array (verticals, keywords) or (sometimes double-)entity-encoded
 * HTML (role descriptions). This module is their single home — shared by the
 * agent query primitives (`src/query`), the plan engine (`src/plan`), and the web
 * views (`src/app`) — so the parsing format lives in one place instead of being
 * copy-pasted per consumer.
 */

/** Parse a JSON-array text column into string chips; tolerate plain text/null. */
export function asList(v: string | null | undefined): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* not JSON */
  }
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decode + strip (possibly double-)entity-encoded HTML to plain prose. Role
 * descriptions arrive encoded — collapse `&amp;` first (they are double-encoded),
 * decode the rest, then strip the now-decoded tags.
 */
export function cleanText(s: string | null): string | null {
  if (!s) return null;
  const t = s
    .replace(/&amp;/g, "&") // collapse one level first (descriptions are double-encoded)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&") // any remaining from &amp;amp;
    .replace(/<[^>]+>/g, " ") // strip tags (now decoded)
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}
