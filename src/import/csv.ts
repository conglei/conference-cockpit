/**
 * A small, dependency-free CSV parser (RFC-4180-ish) built on Node string ops.
 *
 * Deterministic primitive: it turns CSV TEXT into an array of row objects keyed
 * by header. It does NOT know anything about company fields or shapes — that
 * adaptation is the SKILL's job (see .claude/skills/source-companies/SKILL.md),
 * which supplies a column mapping the importer applies. This module only parses.
 *
 * Supported:
 *  - quoted fields with embedded commas, quotes ("" escape), and newlines
 *  - CRLF or LF line endings
 *  - a leading UTF-8 BOM
 *  - ragged rows (missing trailing cells become "")
 *
 * Out of scope (deliberately): alternate delimiters, type coercion, header
 * normalization. Keep it boring and exact.
 */

export type CsvRow = Record<string, string>;

/** Parse CSV text into header + raw string rows (no header objects yet). */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // have we seen any char on the current record?

  // Strip a leading BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ",") {
      pushField();
      started = true;
    } else if (ch === "\r") {
      // swallow; a following \n finishes the record
      if (text[i + 1] !== "\n") pushRecord();
    } else if (ch === "\n") {
      pushRecord();
    } else {
      field += ch;
      started = true;
    }
  }

  // Flush the final record if the file didn't end with a newline.
  if (started || field.length > 0 || record.length > 0) pushRecord();

  return records;
}

/**
 * Parse CSV text into row objects keyed by the header row. Header cells are used
 * verbatim (trimmed) so a supplied mapping can refer to them exactly as written.
 * Returns `{ headers, rows }`. Blank lines are skipped.
 */
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const records = parseCsvRecords(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === ""),
  );
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows: CsvRow[] = records.slice(1).map((rec) => {
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = rec[idx] ?? "";
    });
    return row;
  });
  return { headers, rows };
}
