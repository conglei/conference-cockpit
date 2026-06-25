/**
 * Domain recovery for already-imported companies (ADR-0003 §1, roadmap step 2).
 *
 * The first import resolved identity by name, which left many companies with a
 * wrong or fake domain. The fix is to re-derive the REAL domain by crawling each
 * company's source aggregator page (startups.gallery) and overwriting what's on
 * the row. The crawler (`crawlCompanyDomain`) already turns an aggregator URL
 * into `{ domain, websiteUrl }`; this module drives it over the funnel.
 *
 * The aggregator URL is a TRANSIENT resolution input, never a stored field
 * (ADR-0003 §1): the caller re-reads it from the source CSV at runtime and hands
 * it in as a name→URL map. We persist only the derived domain + website.
 */
import type { CrawledDomain } from "./aggregator";
import { crawlCompanyDomain } from "./aggregator";

/** The slice of the company row this module reads. */
interface RecoverableCompany {
  id: number;
  name: string;
}

/**
 * The minimal repo surface domain recovery needs — a structural subset of
 * `CompanyRepo`, so the real repo satisfies it and tests can pass a tiny stub.
 */
export interface RecoverDomainsRepo {
  list(): RecoverableCompany[];
  update(
    id: number,
    patch: { domain: string; websiteUrl: string; recruitingWebsite?: string },
  ): unknown;
}

/** Crawl function injected for tests; defaults to the real aggregator crawler. */
export type CrawlFn = (url: string) => Promise<CrawledDomain | undefined>;

export interface RecoverDomainsOptions {
  /** Max concurrent crawls (the crawler hits the network). Defaults to 5. */
  concurrency?: number;
  /** Per-company progress callback (for the CLI's live output). */
  onResult?: (event: RecoverDomainsEvent) => void;
}

export interface RecoverDomainsEvent {
  company: RecoverableCompany;
  /** Set when the crawl cleared the confidence bar and the row was overwritten. */
  recovered?: CrawledDomain;
  /** True when this company's name had no aggregator URL in the map (skipped). */
  unmapped?: boolean;
  /** Set when the crawled domain is already owned by another company (skipped). */
  collidedDomain?: string;
}

export interface RecoverDomainsResult {
  /** Companies whose domain + website were overwritten from a crawl. */
  recovered: number;
  /** Mapped companies whose crawl returned nothing — left as-is for the ladder. */
  unresolved: number;
  /** Crawls whose domain collided with another company's (likely duplicate) — skipped. */
  collided: number;
}

/** Is this a SQLite UNIQUE-constraint error (e.g. a domain already owned)? */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = String((err as { message?: string })?.message ?? err);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE constraint failed/i.test(msg);
}

/**
 * Normalize a company name to a stable match key: lower-case, strip everything
 * that isn't a letter or digit. So "Mail0 (mail0.com)" and "mail0" collapse to
 * the same key. The CSV-derived map MUST be keyed the same way.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Recover real domains for already-imported companies by crawling their source
 * aggregator page. For each company whose normalized name is in
 * `nameToAggregatorUrl`, crawl the URL; on a hit, overwrite `domain` +
 * `websiteUrl` through the repo; on a miss (undefined crawl), leave the row
 * untouched so it falls to the recovery ladder. Companies absent from the map
 * are skipped entirely. Runs with bounded concurrency.
 */
export async function recoverDomains(
  repo: RecoverDomainsRepo,
  nameToAggregatorUrl: Map<string, string>,
  crawl: CrawlFn = crawlCompanyDomain,
  opts: RecoverDomainsOptions = {},
): Promise<RecoverDomainsResult> {
  const limit = opts.concurrency ?? 5;

  // Only companies that actually have an aggregator URL are worth crawling.
  const targets = repo
    .list()
    .map((company) => ({ company, url: nameToAggregatorUrl.get(normalizeName(company.name)) }))
    .filter((t): t is { company: RecoverableCompany; url: string } => {
      if (t.url) return true;
      opts.onResult?.({ company: t.company, unmapped: true });
      return false;
    });

  let recovered = 0;
  let unresolved = 0;
  let collided = 0;

  await mapLimit(targets, limit, async ({ company, url }) => {
    const crawled = await crawl(url);
    if (!crawled) {
      unresolved++;
      opts.onResult?.({ company });
      return;
    }
    // `companies.domain` is UNIQUE: a crawled domain another company already owns
    // collides (a likely duplicate, or a bad crawl). Skip that one company and
    // keep going — never abort the whole batch on a single collision.
    try {
      // Only `domain`/`websiteUrl` participate in the UNIQUE collision below;
      // `recruitingWebsite` is just along for the ride, persisted when present.
      repo.update(company.id, {
        domain: crawled.domain,
        websiteUrl: crawled.websiteUrl,
        ...(crawled.recruitingUrl ? { recruitingWebsite: crawled.recruitingUrl } : {}),
      });
      recovered++;
      opts.onResult?.({ company, recovered: crawled });
    } catch (err) {
      if (isUniqueViolation(err)) {
        collided++;
        opts.onResult?.({ company, collidedDomain: crawled.domain });
      } else {
        throw err;
      }
    }
  });

  return { recovered, unresolved, collided };
}

/** Bounded-concurrency async map preserving input order. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}
