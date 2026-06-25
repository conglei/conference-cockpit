/**
 * `refresh` — the mechanical, NO-LLM half of the daily loop (issue 11,
 * PRD user-stories 11 & 39).
 *
 * For each pluggable {@link CompanySource}: fetch → normalize → (per row)
 * dedupe on canonical identity → insert as `status: new` → resolve LinkedIn URL
 * / domain (slice 02). It reuses the exact import primitive (`importRows`,
 * slice 03) so a sourced company gets the same canonical-identity dedupe and
 * graceful, tiered resolution a CSV import does — no duplicate pipeline.
 *
 * It is deliberately deterministic and runnable headless (cron / GitHub Action /
 * launchd): no LLM, no judgment, no interactive prompts. When it finishes it
 * stamps `last_refresh_at` in `app_meta` so the agentic `daily` skill can ask
 * "what's new since the last run". A source that fails to fetch (e.g. a missing
 * key) degrades gracefully — its error becomes a note and the other sources
 * still run, matching the provider tiers' behavior.
 *
 * The judgment half (which new companies to enrich, how to summarize) is NOT
 * here — it lives in `.claude/skills/daily/SKILL.md`. This module is the primitive
 * that skill orchestrates.
 */
import type { AppMetaRepo } from "../db/app-meta-repository";
import type { CompanyRepo, CompanyInput } from "../db/repository";
import type { Company } from "../db/schema";
import type { EnrichmentProvider } from "../providers/types";
import { ProviderConfigError } from "../providers/types";
import type { ResolveOptions } from "../providers/resolve";
import { importRows, type ImportResult } from "../import/import";
import { identityMap, type ColumnMap } from "../import/mapping";
import type { CompanySource, SourcedCompany } from "./types";

/** Per-source outcome within a refresh run. */
export interface SourceRefreshResult {
  source: string;
  kind: string;
  fetched: number;
  result: ImportResult;
  /** Non-fatal diagnostics (e.g. the source degraded gracefully). */
  notes: string[];
}

export interface RefreshResult {
  /** Per-source breakdowns. */
  sources: SourceRefreshResult[];
  inserted: number;
  duplicates: number;
  skipped: number;
  /** The `last_refresh_at` watermark stamped at the end of the run (ms). */
  refreshedAt: number;
}

export interface RefreshDeps {
  companies: CompanyRepo;
  appMeta: AppMetaRepo;
  /** Primary enrichment provider (FakeProvider offline). */
  provider: EnrichmentProvider;
}

export interface RefreshOptions {
  /** Web-search fallback provider for resolution (slice 02), if configured. */
  resolve?: ResolveOptions;
  /** Override the watermark timestamp (tests). Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Run the mechanical refresh over the given sources and persist
 * `last_refresh_at`. All DB writes go through the typed data layer.
 */
export async function refresh(
  deps: RefreshDeps,
  sources: CompanySource[],
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const { companies, appMeta, provider } = deps;
  const out: SourceRefreshResult[] = [];

  for (const source of sources) {
    let fetched: SourcedCompany[];
    const notes: string[] = [];
    try {
      fetched = await source.fetch();
    } catch (err) {
      // Graceful: a source that can't fetch (missing key, network) becomes a
      // note and the run continues with the remaining sources.
      if (err instanceof ProviderConfigError) {
        notes.push(`[${source.name}] ${err.message}`);
      } else {
        notes.push(`[${source.name}] unexpected error: ${String(err)}`);
      }
      out.push({
        source: source.name,
        kind: source.kind,
        fetched: 0,
        result: { inserted: 0, duplicates: 0, skipped: 0, outcomes: [] },
        notes,
      });
      continue;
    }

    // A SourcedCompany is already canonical, so feed it through the import
    // primitive as a plain row mapped 1:1 by the identity passthrough. This
    // reuses slice 03's dedupe + slice 02's tiered resolve verbatim.
    const rows = fetched.map(toRow);
    const map = canonicalMap();
    // The import primitive records first-touch provenance directly, so each
    // pluggable source stamps its own `source` kind (PRD: pluggable sources).
    const result = await importRows(companies, provider, rows, map, {
      source: source.kind,
      sourceDetail: source.name,
      resolve: opts.resolve,
    });

    out.push({
      source: source.name,
      kind: source.kind,
      fetched: fetched.length,
      result,
      notes,
    });
  }

  const refreshedAt = opts.now ?? Date.now();
  appMeta.setLastRefreshAt(refreshedAt);

  return {
    sources: out,
    inserted: sum(out, (s) => s.result.inserted),
    duplicates: sum(out, (s) => s.result.duplicates),
    skipped: sum(out, (s) => s.result.skipped),
    refreshedAt,
  };
}

/**
 * Companies created since a watermark — the "what's new since last run" query
 * the `daily` skill reads (PRD user-story 40). Pure read through the data layer.
 * A null/undefined watermark means "everything new" (first ever run).
 */
export function newCompaniesSince(
  companies: CompanyRepo,
  since: number | undefined,
): Company[] {
  const all = companies.list();
  const cutoff = since ?? 0;
  return all
    .filter((c) => c.createdAt > cutoff)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Flatten a SourcedCompany into a CSV-row-like record (canonical headers). */
function toRow(c: SourcedCompany): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== null && v !== "") row[k] = String(v);
  }
  return row;
}

/**
 * Identity passthrough over the canonical fields a source can populate. We build
 * it from the full mappable set so any present field flows through 1:1 (no
 * heuristic guessing — the headers ARE the field names here).
 */
function canonicalMap(): ColumnMap {
  return identityMap([
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
    "domain",
    "linkedinUrl",
  ]);
}

function sum(items: SourceRefreshResult[], pick: (s: SourceRefreshResult) => number): number {
  return items.reduce((acc, s) => acc + pick(s), 0);
}
