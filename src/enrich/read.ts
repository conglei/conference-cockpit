import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Read a deep-dive markdown file given the `deep_dive_path` / `notes_path`
 * stored on a row. Paths are stored as written by the enrich flow; they may be
 * absolute (tests, temp dirs) or repo-relative (default `companies/<slug>.md`).
 *
 * Returns the file contents, or `undefined` if the path is missing/unreadable —
 * the UI degrades to an "not enriched yet" message rather than throwing.
 */
export function readDeepDive(
  path: string | null | undefined,
  baseDir: string = process.cwd(),
): string | undefined {
  if (!path) return undefined;
  const resolved = isAbsolute(path) ? path : join(baseDir, path);
  try {
    return readFileSync(resolved, "utf8");
  } catch {
    return undefined;
  }
}
