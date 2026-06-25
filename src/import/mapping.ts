/**
 * The column-mapping seam — how a CSV row of ANY shape becomes a canonical
 * company input.
 *
 * The importer carries NO heuristic header dictionary. It does not guess that
 * "Company" means name or that "Round Type" means latestRound. Instead the
 * CALLER (the `source-companies` skill — an agent or human reasoning about a
 * specific file's headers and sample rows) supplies a `ColumnMap`: for each
 * canonical company field, either a source header to copy verbatim, or a
 * `{ from, transform }` that derives the value (split a combined cell, pull a
 * domain out of a messy URL, normalize an unfamiliar round vocabulary, …).
 *
 * The only built-in mapping is `identityMap`: header → field 1:1 passthrough,
 * used when a CSV's headers already equal canonical field names. Everything
 * shape-specific lives in the supplied map, not in this code.
 */

import type { CsvRow } from "./csv";
import type { CompanyInput } from "../db/repository";

/**
 * The subset of `companies` fields a CSV import may populate. These are the
 * "incoming firmographics"; identity (`domain`/`linkedin_url`), `status`,
 * `source`, `slug`, and timestamps are owned by the import flow, not the map.
 */
export const MAPPABLE_FIELDS = [
  "name",
  "websiteUrl",
  "description",
  "stage",
  "category",
  "location",
  "workType",
  "sizeBand",
  "latestRound",
  "latestAmount",
  "lastFundingDate",
  "leadInvestor",
  // Identity hints the caller may pre-populate when the CSV already carries
  // them; the resolver (slice 02) fills whatever is left blank.
  "domain",
  "linkedinUrl",
] as const;

export type MappableField = (typeof MAPPABLE_FIELDS)[number];

/**
 * TRANSIENT resolve-hint keys a `ColumnMap` may carry. These are deliberately
 * NOT in `MAPPABLE_FIELDS`, so they are never copied onto a company row or
 * persisted as a column. They feed the import flow's data-cleansing step only.
 *
 * `aggregatorUrl` designates which CSV column holds the per-company aggregator
 * page (e.g. a startups.gallery link). The importer crawls it to derive the
 * real domain + website, then discards the URL (ADR-0003 §1).
 */
export const RESOLVE_HINT_FIELDS = ["aggregatorUrl"] as const;

export type ResolveHintField = (typeof RESOLVE_HINT_FIELDS)[number];

/** The transient hints extracted from a row — never written to the DB. */
export type ResolveHints = Partial<Record<ResolveHintField, string>>;

/**
 * One column's mapping. Two forms:
 *  - a plain string: copy the named source header verbatim (trimmed).
 *  - `{ from, transform }`: read `from` (a single header, or several) and run
 *    the caller's `transform` to derive the value. `from` may be omitted when
 *    the transform synthesizes the value from the whole row.
 */
export type ColumnRule =
  | string
  | {
      /** Source header(s) to read. Omit to receive the whole row. */
      from?: string | string[];
      /**
       * Derive the canonical value. Receives the picked cell(s) as a record
       * keyed by the requested header(s), plus the full row for cross-column
       * synthesis. Return `undefined`/`""` to leave the field unset.
       */
      transform: (picked: CsvRow, row: CsvRow) => string | undefined;
    };

/**
 * A full mapping: canonical field → rule. Every field is optional.
 *
 * A map may ALSO carry transient resolve-hint rules (e.g. `aggregatorUrl`).
 * Those keys are not company columns — `applyMapping` ignores them and only
 * `extractResolveHints` reads them — so a hint can never be persisted as a field.
 */
export type ColumnMap = Partial<Record<MappableField, ColumnRule>> &
  Partial<Record<ResolveHintField, ColumnRule>>;

/**
 * Identity passthrough: for a CSV whose headers already ARE canonical field
 * names, map each present header to its field 1:1. This is the ONLY built-in
 * mapping — it encodes no synonyms, no keyword guessing, no per-shape knowledge.
 */
export function identityMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const fieldSet = new Set<string>(MAPPABLE_FIELDS);
  for (const h of headers) {
    if (fieldSet.has(h)) {
      map[h as MappableField] = h;
    }
  }
  return map;
}

/** Apply a single rule to a row, returning the derived value (or undefined). */
function applyRule(rule: ColumnRule, row: CsvRow): string | undefined {
  if (typeof rule === "string") {
    const v = row[rule];
    return v === undefined ? undefined : v.trim();
  }
  const fromList =
    rule.from === undefined ? [] : Array.isArray(rule.from) ? rule.from : [rule.from];
  const picked: CsvRow = {};
  for (const h of fromList) picked[h] = (row[h] ?? "").trim();
  const out = rule.transform(picked, row);
  return out === undefined ? undefined : out.trim();
}

/**
 * Apply a supplied mapping to one parsed CSV row, producing the canonical
 * firmographic fields. Empty strings are dropped (treated as "not provided").
 * `name` is required by the schema; rows that map to no usable name should be
 * filtered by the import flow.
 */
export function applyMapping(map: ColumnMap, row: CsvRow): Partial<CompanyInput> {
  const out: Partial<CompanyInput> = {};
  for (const field of MAPPABLE_FIELDS) {
    const rule = map[field];
    if (rule === undefined) continue;
    const value = applyRule(rule, row);
    if (value !== undefined && value !== "") {
      // workType is enum-typed in the schema; the cast is safe because the
      // supplied transform is responsible for producing a valid enum value.
      (out as Record<string, string>)[field] = value;
    }
  }
  return out;
}

/**
 * Extract the TRANSIENT resolve hints a mapping designates for one row (same
 * rule evaluation as `applyMapping`, but only over `RESOLVE_HINT_FIELDS`). These
 * never land on a company column — the import flow consumes them as a
 * data-cleansing input (e.g. crawl the aggregator URL to derive a domain) and
 * discards them. Empty values are dropped (treated as "not provided").
 */
export function extractResolveHints(map: ColumnMap, row: CsvRow): ResolveHints {
  const out: ResolveHints = {};
  for (const field of RESOLVE_HINT_FIELDS) {
    const rule = map[field];
    if (rule === undefined) continue;
    const value = applyRule(rule, row);
    if (value !== undefined && value !== "") {
      out[field] = value;
    }
  }
  return out;
}
