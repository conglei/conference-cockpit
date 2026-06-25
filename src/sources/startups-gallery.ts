/**
 * The startups.gallery source adapter (PRD user-story 9), built behind the
 * pluggable {@link CompanySource} seam so it sits alongside CSV import and any
 * future feed (user-story 10: "adding a new source is just a new adapter").
 *
 * Live scraping is intentionally injectable rather than hard-wired: the network
 * `fetcher` is a dependency, so tests (and offline `refresh` runs) drive the
 * adapter from fixtures with zero network — mirroring how `FakeProvider` backs
 * the EnrichmentProvider seam. In production a real fetcher (HTTP + HTML/JSON
 * parse, or a saved export) is injected; the normalization below is identical
 * either way.
 *
 * No LLM here. The adapter mechanically maps the feed's raw fields onto the
 * canonical {@link SourcedCompany} shape. Crucially, a startups.gallery *profile
 * URL is not the company's domain* (it's an aggregator link, per the
 * `source-companies` skill), so we deliberately do NOT set `domain` from it —
 * we leave identity blank and let the refresh resolver find the real domain.
 */
import { ProviderConfigError } from "../providers/types";
import type { CompanySource, SourcedCompany } from "./types";

/**
 * The raw record shape a startups.gallery fetch yields (a subset of what the
 * feed carries). Loose by design — a real fetcher fills what it can; the adapter
 * normalizes whatever is present.
 */
export interface StartupsGalleryRecord {
  name: string;
  tagline?: string;
  description?: string;
  category?: string;
  sector?: string;
  stage?: string;
  location?: string;
  city?: string;
  workType?: string;
  sizeBand?: string;
  headcount?: string;
  latestRound?: string;
  latestAmount?: string;
  lastFundingDate?: string;
  leadInvestor?: string;
  /** The company's own website, if the feed exposes it (NOT the gallery URL). */
  website?: string;
  /** The startups.gallery profile URL — an aggregator link, never the domain. */
  galleryUrl?: string;
  linkedinUrl?: string;
}

/** Fetches the current batch of raw records from startups.gallery. */
export type StartupsGalleryFetcher = () => Promise<StartupsGalleryRecord[]>;

export interface StartupsGalleryOptions {
  /**
   * The network fetcher. Injected so tests/offline runs use fixtures and
   * production injects a real HTTP scraper. If omitted, the adapter throws a
   * ProviderConfigError on `fetch()` with actionable guidance (graceful, like
   * the provider tiers).
   */
  fetcher?: StartupsGalleryFetcher;
}

export class StartupsGallerySource implements CompanySource {
  readonly name = "startups.gallery";
  readonly kind = "startups_gallery";
  private readonly fetcher?: StartupsGalleryFetcher;

  constructor(opts: StartupsGalleryOptions = {}) {
    this.fetcher = opts.fetcher;
  }

  async fetch(): Promise<SourcedCompany[]> {
    if (!this.fetcher) {
      throw new ProviderConfigError(
        "startups.gallery source has no fetcher configured. Inject a " +
          "StartupsGalleryFetcher (a real HTTP scraper, or a saved export) " +
          "via `new StartupsGallerySource({ fetcher })`. Tests/offline runs " +
          "inject a fixture fetcher.",
      );
    }
    const records = await this.fetcher();
    return records.map(normalize).filter((c): c is SourcedCompany => c !== undefined);
  }
}

/**
 * Build a fixture-backed adapter from a fixed list of records — the offline
 * seam used by tests and deterministic `refresh` dry-runs.
 */
export function fakeStartupsGallerySource(
  records: StartupsGalleryRecord[],
): StartupsGallerySource {
  return new StartupsGallerySource({ fetcher: async () => records });
}

/** Normalize one raw record to the canonical shape (drops nameless rows). */
function normalize(r: StartupsGalleryRecord): SourcedCompany | undefined {
  const name = r.name?.trim();
  if (!name) return undefined;

  const description = [r.tagline, r.description, r.sector]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" — ");

  const out: SourcedCompany = { name };
  if (description) out.description = description;
  assign(out, "category", r.category ?? r.sector);
  assign(out, "stage", r.stage);
  assign(out, "location", r.location ?? r.city);
  assign(out, "workType", r.workType);
  assign(out, "sizeBand", r.sizeBand ?? r.headcount);
  assign(out, "latestRound", r.latestRound);
  assign(out, "latestAmount", r.latestAmount);
  assign(out, "lastFundingDate", r.lastFundingDate);
  assign(out, "leadInvestor", r.leadInvestor);
  assign(out, "websiteUrl", r.website);
  // The company's real apex domain, derived ONLY from its own website — never
  // from the gallery profile URL (an aggregator link, not the company's domain).
  assign(out, "domain", domainFromUrl(r.website));
  assign(out, "linkedinUrl", r.linkedinUrl);
  return out;
}

function assign(out: SourcedCompany, key: keyof SourcedCompany, value?: string): void {
  const v = value?.trim();
  if (v) (out as unknown as Record<string, string>)[key as string] = v;
}

/** Extract a clean apex domain from a website URL (strip scheme + www.). */
function domainFromUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const u = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}
