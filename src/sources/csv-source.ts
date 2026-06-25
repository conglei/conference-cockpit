/**
 * The CSV source adapter — CSV import expressed behind the pluggable
 * {@link CompanySource} seam (PRD user-story 10: "sourcing is pluggable …
 * adding a new source is just a new adapter"). It lets `refresh` treat a CSV
 * export and the startups.gallery feed uniformly.
 *
 * The adaptation (a CSV of arbitrary shape → canonical fields) is still the
 * `source-companies` skill's job at runtime via the `ColumnMap` it supplies
 * (ADR-0002); this adapter just parses + applies that map, yielding canonical
 * {@link SourcedCompany} rows. The mechanical `import-csv` CLI remains the
 * primary CSV path; this adapter exists so a CSV can also participate in a batch
 * `refresh` alongside other sources.
 */
import { parseCsv } from "../import/csv";
import { applyMapping, identityMap, type ColumnMap } from "../import/mapping";
import type { CompanySource, SourcedCompany } from "./types";

export interface CsvSourceOptions {
  /** The CSV text to read. */
  csvText: string;
  /**
   * The column mapping supplied by the `source-companies` skill. Omit to use
   * identity passthrough (headers that already equal canonical field names).
   */
  map?: ColumnMap;
  /** Provenance label for this file (e.g. the filename). */
  name?: string;
}

export class CsvSource implements CompanySource {
  readonly name: string;
  readonly kind = "csv";
  private readonly csvText: string;
  private readonly map?: ColumnMap;

  constructor(opts: CsvSourceOptions) {
    this.csvText = opts.csvText;
    this.map = opts.map;
    this.name = opts.name ?? "csv";
  }

  async fetch(): Promise<SourcedCompany[]> {
    const { headers, rows } = parseCsv(this.csvText);
    const map = this.map ?? identityMap(headers);
    const out: SourcedCompany[] = [];
    for (const row of rows) {
      const mapped = applyMapping(map, row);
      const name = mapped.name?.trim();
      if (!name) continue;
      out.push({ ...(mapped as SourcedCompany), name });
    }
    return out;
  }
}
