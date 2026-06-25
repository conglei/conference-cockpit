/**
 * The pluggable connection-source seam (issue 06).
 *
 * A `ConnectionSource` yields the user's **1st-degree contacts** — the people
 * they already know — as a list of normalized `Connection` records. The first
 * (and currently only) adapter reads a downloaded LinkedIn "Connections" CSV
 * export, but the interface deliberately hides *where* the contacts came from so
 * the source can be swapped or extended later (a different export, an address
 * book, a manual list) without touching the ingest/cross-reference/who-next code.
 *
 * Per ADR-0002 this is a deterministic primitive: a source does NO guessing about
 * messy/unknown shapes — adapting a novel export format is the SKILL's job
 * (.claude/skills/find-referrers/SKILL.md), which hands a clean source here.
 */

/** One 1st-degree contact, normalized away from any source-specific shape. */
export interface Connection {
  /** Display name (required — the minimum to create a person row). */
  name: string;
  /** Canonical LinkedIn profile URL when known (the dedupe identity). */
  linkedinUrl?: string;
  /** Current title / headline when the source provides one. */
  title?: string;
  /** Current company name (free text) when the source provides one. */
  company?: string;
}

/**
 * A source of 1st-degree contacts. Implementations are constructed from their
 * own raw input (a CSV string, a file path, an API client…) and expose a single
 * `read()` that returns clean, normalized `Connection`s.
 */
export interface ConnectionSource {
  /** Stable identifier recorded for provenance, e.g. "linkedin-csv". */
  readonly name: string;
  /** Yield all 1st-degree contacts this source knows about. */
  read(): Connection[];
}
