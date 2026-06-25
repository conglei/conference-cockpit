/**
 * The CSV import flow — a thin deterministic primitive.
 *
 * Pipeline per row:
 *   parse (csv.ts) → apply the SUPPLIED mapping (mapping.ts) → resolve to a
 *   canonical identity (domain/linkedin via slice 02) → dedupe on that identity
 *   (repo.findByIdentity, ADR-0001) → insert as `status: new`, `source: csv`.
 *
 * Idempotent: a row whose resolved identity already exists is skipped, so
 * running the same import twice — or re-importing the same company from a
 * differently-shaped CSV — creates no duplicates.
 *
 * This module owns NO shape knowledge. The `ColumnMap` it consumes is supplied
 * by the caller (the `source-companies` skill). The provider is injected so
 * tests run offline against `FakeProvider`.
 */

import type { CompanyRepo, CompanyInput } from "../db/repository";
import type { Company, Source } from "../db/schema";
import type { EnrichmentProvider } from "../providers/types";
import { crawlCompanyDomain, type CrawledDomain } from "../providers/aggregator";
import { resolveCompany, type ResolveOptions } from "../providers/resolve";
import { parseCsv } from "./csv";
import { applyMapping, extractResolveHints, type ColumnMap } from "./mapping";

/** Crawl an aggregator URL → real { domain, websiteUrl }. Injectable for tests. */
export type CrawlFn = (url: string) => Promise<CrawledDomain | undefined>;

export interface ImportOptions {
  /** First-touch provenance recorded on every inserted row. Defaults to `csv`. */
  source?: Source;
  /** Provenance detail recorded on every row (e.g. the CSV filename or scrape URL). */
  sourceDetail?: string;
  /** Optional web-search fallback provider for resolution (slice 02). */
  resolve?: ResolveOptions;
  /**
   * Aggregator-page crawler used by the data-cleansing step (ADR-0003 §1). When
   * a row carries a transient `aggregatorUrl` hint, the importer crawls it to
   * derive the real domain + website BEFORE falling back to name resolution.
   * Defaults to the real `crawlCompanyDomain`; injected as a stub in tests.
   */
  crawl?: CrawlFn;
}

export type RowOutcome =
  | { kind: "inserted"; company: Company }
  | { kind: "duplicate"; company: Company; matched: Company }
  | { kind: "skipped"; reason: string };

export interface ImportResult {
  inserted: number;
  duplicates: number;
  skipped: number;
  outcomes: RowOutcome[];
}

/**
 * Import already-parsed rows through a supplied mapping. Exposed separately so
 * the skill can apply a mapping it built programmatically without re-parsing.
 */
export async function importRows(
  repo: CompanyRepo,
  provider: EnrichmentProvider,
  rows: Record<string, string>[],
  map: ColumnMap,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const outcomes: RowOutcome[] = [];
  const crawl = opts.crawl ?? crawlCompanyDomain;

  for (const row of rows) {
    const mapped = applyMapping(map, row);
    // Transient resolve hints (e.g. the aggregator URL) — read from the row but
    // NEVER copied onto a company column.
    const hints = extractResolveHints(map, row);
    const name = mapped.name?.trim();
    if (!name) {
      outcomes.push({ kind: "skipped", reason: "row produced no company name" });
      continue;
    }

    // Pre-insert dedupe on any identity the mapping already carried (cheap path
    // before we even create the row).
    const preMatch = repo.findByIdentity({
      domain: mapped.domain ?? null,
      linkedinUrl: mapped.linkedinUrl ?? null,
    });
    if (preMatch) {
      outcomes.push({ kind: "duplicate", company: preMatch, matched: preMatch });
      continue;
    }

    const input: CompanyInput = {
      ...(mapped as CompanyInput),
      name,
      slug: uniqueSlug(repo, name),
      status: "new",
      source: opts.source ?? "csv",
      sourceDetail: opts.sourceDetail ?? null,
    };

    const created = repo.create(input);

    // Data-cleansing step (ADR-0003 §1): if the row carried an aggregator URL
    // and we don't already have a domain, crawl it to derive the REAL domain +
    // website and anchor identity on that — far less ambiguous than guessing by
    // name. The aggregator URL itself is TRANSIENT and never persisted.
    let resolved = created;
    let crawledDomain = false;
    if (!created.domain && hints.aggregatorUrl) {
      const crawled = await crawl(hints.aggregatorUrl);
      if (crawled) {
        resolved =
          repo.update(created.id, {
            domain: crawled.domain,
            websiteUrl: crawled.websiteUrl,
          }) ?? created;
        crawledDomain = true;
      }
    }

    // Only fall through to name-based resolution (slice 02) when the crawl did
    // not yield a domain. Slice 02 runs offline under FakeProvider; it refuses
    // to write an identity already owned by another row, so a cross-shape
    // duplicate comes back here still unresolved on its own fields.
    if (!crawledDomain) {
      const res = await resolveCompany(repo, resolved.id, provider, opts.resolve ?? {});
      resolved = res.company;
    }

    // Determine the canonical identity this row resolves to — taken from the
    // persisted row when slice 02 wrote it, else the identity slice 02 *would*
    // have written but dropped because another row already owns it.
    const identity = await canonicalIdentity(provider, resolved, opts.resolve ?? {});

    // Idempotency / cross-shape dedupe: if that identity already belongs to a
    // DIFFERENT row, this import is a duplicate — roll back the just-created row.
    const dupe = findOtherByIdentity(repo, created.id, identity);
    if (dupe) {
      repo.delete(created.id);
      outcomes.push({ kind: "duplicate", company: resolved, matched: dupe });
      continue;
    }

    outcomes.push({ kind: "inserted", company: resolved });
  }

  return tally(outcomes);
}

/**
 * Parse a CSV string and import it through a supplied mapping. The top-level
 * entry point the CLI calls.
 */
export async function importCsv(
  repo: CompanyRepo,
  provider: EnrichmentProvider,
  csvText: string,
  map: ColumnMap,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const { rows } = parseCsv(csvText);
  return importRows(repo, provider, rows, map, opts);
}

interface Identity {
  domain?: string | null;
  linkedinUrl?: string | null;
}

/**
 * The canonical identity a row resolves to. Prefer what slice 02 actually
 * persisted; if it left the row unresolved (e.g. it dropped an identity another
 * row already owns), ask the provider what it would have produced so cross-shape
 * duplicates are still caught. Pure read — never writes.
 */
async function canonicalIdentity(
  provider: EnrichmentProvider,
  row: Company,
  opts: ResolveOptions,
): Promise<Identity> {
  if (row.domain || row.linkedinUrl) {
    return { domain: row.domain, linkedinUrl: row.linkedinUrl };
  }
  const query = {
    name: row.name,
    websiteUrl: row.websiteUrl ?? undefined,
    hint: row.location ?? undefined,
  };
  for (const p of [provider, opts.searchProvider]) {
    if (!p) continue;
    try {
      const r = await p.resolveCompany(query);
      if (r.domain || r.linkedinUrl) return { domain: r.domain, linkedinUrl: r.linkedinUrl };
    } catch {
      // graceful: ignore and fall through (matches slice 02 behavior)
    }
  }
  return {};
}

/** Find a company matching this identity but with a different id. */
function findOtherByIdentity(
  repo: CompanyRepo,
  selfId: number,
  identity: Identity,
): Company | undefined {
  const match = repo.findByIdentity(identity);
  return match && match.id !== selfId ? match : undefined;
}

function tally(outcomes: RowOutcome[]): ImportResult {
  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o.kind === "inserted") inserted++;
    else if (o.kind === "duplicate") duplicates++;
    else skipped++;
  }
  return { inserted, duplicates, skipped, outcomes };
}

/** kebab-case slug, made unique against existing rows (ADR-0001 convention). */
function uniqueSlug(repo: CompanyRepo, name: string): string {
  const base = slugify(name) || "company";
  let candidate = base;
  let n = 2;
  while (repo.getBySlug(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
