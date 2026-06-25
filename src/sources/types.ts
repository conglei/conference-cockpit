/**
 * The pluggable company-source seam (PRD "Sourcing companies": user-stories 9,
 * 10, 11). A `CompanySource` is anything that can produce a batch of fresh
 * companies — a CSV export, the startups.gallery feed, and (later) other feeds —
 * normalized to one canonical shape so the `refresh` pipeline treats them
 * uniformly. Adding a new source is just a new adapter implementing this
 * interface, exactly as a new EnrichmentProvider is just a new adapter of that
 * seam.
 *
 * A source does NOT touch the database, resolve identities, or dedupe — it only
 * *fetches and normalizes*. The mechanical fetch → dedupe → insert → resolve
 * pipeline (see `src/sources/refresh.ts`) owns all of that, so every source
 * gets the canonical-identity dedupe and graceful resolution for free.
 *
 * No LLM lives here. A source's job is mechanical extraction; any judgment about
 * an arbitrary CSV's shape is the `source-companies` skill's job at runtime
 * (ADR-0002), expressed as the `ColumnMap` it hands the CSV adapter.
 */

import type { Source } from "../db/schema";

/**
 * A single company a source yields, already normalized to canonical
 * firmographic fields. `name` is required; everything else is optional. `domain`
 * / `linkedinUrl` are identity *hints* — supply them only when the source
 * already carries a clean canonical value (a real company domain, not an
 * aggregator URL); otherwise leave them blank and the refresh pipeline's
 * resolver fills them in.
 */
export interface SourcedCompany {
  name: string;
  websiteUrl?: string;
  description?: string;
  stage?: string;
  category?: string;
  location?: string;
  workType?: string;
  sizeBand?: string;
  latestRound?: string;
  latestAmount?: string;
  lastFundingDate?: string;
  leadInvestor?: string;
  domain?: string;
  linkedinUrl?: string;
}

/**
 * A pluggable source of companies. Implementations are fixture-backed or
 * live-fetching; either way they only fetch + normalize. `kind` MUST be one of
 * the `companies.source` enum values (schema.ts `SOURCE`) so provenance is
 * recorded consistently.
 */
export interface CompanySource {
  /** Human-readable adapter name, e.g. "startups.gallery". */
  readonly name: string;
  /**
   * The `companies.source` enum value rows from this adapter are tagged with,
   * e.g. "startups_gallery" | "csv".
   */
  readonly kind: Source;
  /** Fetch the current batch of companies, normalized to {@link SourcedCompany}. */
  fetch(): Promise<SourcedCompany[]>;
}
