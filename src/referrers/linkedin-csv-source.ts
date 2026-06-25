/**
 * The LinkedIn "Connections" CSV-export adapter (issue 06) — the first
 * `ConnectionSource`.
 *
 * LinkedIn lets a member download their connections from
 * Settings → Data privacy → Get a copy of your data → "Connections". The file
 * is a CSV whose data rows are preceded by a short human-readable preamble
 * ("Notes:" lines + a blank line) before the real header row:
 *
 *     Notes:
 *     "When exporting your connection data, …"
 *
 *     First Name,Last Name,URL,Email Address,Company,Position,Connected On
 *     Jane,Doe,https://www.linkedin.com/in/janedoe,,Giga,Founding Engineer,01 Jun 2026
 *
 * This adapter parses that exact, well-known shape into `Connection`s. It is a
 * deterministic primitive (ADR-0002): it understands ONLY LinkedIn's documented
 * export columns. Any other / re-shaped export is the SKILL's job to normalize
 * before constructing a source.
 */

import { parseCsv } from "../import/csv";
import type { Connection, ConnectionSource } from "./connection-source";

/** The header row LinkedIn writes (case-insensitive match on these names). */
const FIRST_NAME = "first name";
const LAST_NAME = "last name";
const URL = "url";
const COMPANY = "company";
const POSITION = "position";

/**
 * Drop LinkedIn's "Notes:" preamble so the real header row leads. The preamble
 * is everything up to (and including) the blank line that precedes the header.
 * If there is no preamble (already-clean CSV) the text is returned unchanged.
 */
export function stripLinkedinPreamble(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  // Only strip when the file actually opens with the "Notes:" preamble; a
  // clean export (or our test fixtures) must pass through untouched.
  if (!/^\s*notes:/i.test(lines[0] ?? "")) return text;
  const blank = lines.findIndex((l) => l.trim() === "");
  if (blank === -1) return text;
  return lines.slice(blank + 1).join("\n");
}

/** A `ConnectionSource` over a downloaded LinkedIn connections CSV (as text). */
export class LinkedinCsvSource implements ConnectionSource {
  readonly name = "linkedin-csv";
  private readonly csvText: string;

  constructor(csvText: string) {
    this.csvText = csvText;
  }

  read(): Connection[] {
    const { headers, rows } = parseCsv(stripLinkedinPreamble(this.csvText));
    const idx = headerIndex(headers);

    const out: Connection[] = [];
    for (const row of rows) {
      const first = idx.firstName ? (row[idx.firstName] ?? "").trim() : "";
      const last = idx.lastName ? (row[idx.lastName] ?? "").trim() : "";
      const name = [first, last].filter(Boolean).join(" ").trim();
      if (!name) continue; // no name → not a usable contact

      const linkedinUrl = idx.url ? normalizeUrl(row[idx.url]) : undefined;
      const title = idx.position ? (row[idx.position] ?? "").trim() || undefined : undefined;
      const company = idx.company ? (row[idx.company] ?? "").trim() || undefined : undefined;

      out.push({ name, linkedinUrl, title, company });
    }
    return out;
  }
}

/** Resolve the documented LinkedIn columns case-insensitively. */
function headerIndex(headers: string[]): {
  firstName?: string;
  lastName?: string;
  url?: string;
  company?: string;
  position?: string;
} {
  const byLower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  return {
    firstName: byLower.get(FIRST_NAME),
    lastName: byLower.get(LAST_NAME),
    url: byLower.get(URL),
    company: byLower.get(COMPANY),
    position: byLower.get(POSITION),
  };
}

/** Trim + drop empty LinkedIn URLs; leave the value otherwise verbatim. */
function normalizeUrl(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  return v ? v : undefined;
}
