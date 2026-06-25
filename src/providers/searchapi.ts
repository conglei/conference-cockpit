import { cacheKey, getResponseCache, readBody, type ResponseCache } from "./cache";
import type { CostMeter } from "./cost";
import {
  ProviderConfigError,
  type CompanyQuery,
  type CompanyResolution,
  type Employee,
  type EmployeesQuery,
  type EnrichmentProvider,
  type JobSearchResult,
  type Profile,
  type ProfileQuery,
  type SearchQuery,
  type SearchResult,
  type WebSearchResult,
} from "./types";

const BASE_URL = "https://www.searchapi.io/api/v1/search";
const KEY_ENV = "SEARCHAPI_KEY";

/**
 * SearchAPI (searchapi.io) adapter — Google web search (LinkedIn-URL
 * resolution, funding/founder background) and the Google Jobs engine (powers
 * find-jobs). Plain HTTP; key from `SEARCHAPI_KEY` in `.env.local`. Degrades
 * gracefully (ProviderConfigError naming the env var) when the key is missing
 * or a call fails.
 *
 * NOTE: No live key here; the response parsing follows searchapi.io's
 * documented `organic_results` / `jobs` shapes and is defensive.
 */
export class SearchApiProvider implements EnrichmentProvider {
  readonly name = "searchapi";
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly meter: CostMeter | undefined;
  private readonly cache: ResponseCache;

  constructor(
    opts: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      meter?: CostMeter;
      /** Response cache (defaults to the process singleton; tests inject one). */
      cache?: ResponseCache;
    } = {},
  ) {
    this.apiKey = opts.apiKey ?? process.env[KEY_ENV];
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.meter = opts.meter;
    this.cache = opts.cache ?? getResponseCache();
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderConfigError(
        `SearchAPI is not configured: set ${KEY_ENV} in .env.local to enable Google web ` +
          `search + Google Jobs (or set ENRICHMENT_PROVIDER=fake to run offline).`,
      );
    }
    return this.apiKey;
  }

  private async call(params: Record<string, string>): Promise<Record<string, unknown>> {
    const key = this.requireKey();
    const url = new URL(BASE_URL);
    url.searchParams.set("api_key", key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    // Cache HIT: return the stored body without hitting the network or the meter
    // (cache hits are free). The key folds in the params but NOT the api_key, so
    // the cache stays stable across key rotations and never stores the secret.
    const keyUrl = new URL(BASE_URL);
    for (const [k, v] of Object.entries(params)) keyUrl.searchParams.set(k, v);
    const ck = cacheKey(this.name, "GET", keyUrl.toString());
    const hit = this.cache.get(ck);
    if (hit) return JSON.parse(hit.response) as Record<string, unknown>;

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
    } catch (cause) {
      throw new ProviderConfigError(
        `SearchAPI request failed (network error). Check connectivity and ${KEY_ENV}. ` +
          `Cause: ${String(cause)}`,
      );
    }
    if (!res.ok) {
      throw new ProviderConfigError(
        `SearchAPI returned ${res.status} ${res.statusText}. Verify ${KEY_ENV} in .env.local ` +
          `and your plan/quota.`,
      );
    }
    // MISS on a 2xx: store the raw text, bill the call, return the parsed JSON.
    const text = await readBody(res);
    this.cache.set(ck, {
      provider: this.name,
      request: ck,
      response: text,
      status: res.status,
    });
    this.meter?.record("webSearch");
    return JSON.parse(text) as Record<string, unknown>;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (query.engine === "jobs") {
      const data = await this.call({ engine: "google_jobs", q: query.q });
      const jobs = Array.isArray(data.jobs) ? (data.jobs as Record<string, unknown>[]) : [];
      const out: JobSearchResult[] = jobs.map((j) => ({
        title: str(j.title) ?? "",
        companyName: str(j.company_name) ?? "",
        location: str(j.location),
        link: str(j.apply_link) ?? str(j.link),
        externalId: str(j.job_id),
        postedDate: str(j.posted_at) ?? str(j.detected_extensions),
        description: str(j.description),
      }));
      return query.limit ? out.slice(0, query.limit) : out;
    }

    const data = await this.call({ engine: "google", q: query.q });
    const organic = Array.isArray(data.organic_results)
      ? (data.organic_results as Record<string, unknown>[])
      : [];
    const out: WebSearchResult[] = organic.map((r) => ({
      title: str(r.title) ?? "",
      link: str(r.link) ?? "",
      snippet: str(r.snippet),
    }));
    return query.limit ? out.slice(0, query.limit) : out;
  }

  /**
   * Resolve via Google web search: find the LinkedIn company page and a likely
   * official domain. This is the web-search fallback tier of the resolver.
   */
  async resolveCompany(query: CompanyQuery): Promise<CompanyResolution> {
    const results = (await this.search({
      q: `${query.name} ${query.hint ?? ""} LinkedIn`.trim(),
      engine: "web",
    })) as WebSearchResult[];

    const linkedinUrl = results
      .map((r) => r.link)
      .find((l) => /linkedin\.com\/company\//i.test(l));

    const domain = results
      .map((r) => r.link)
      .map(domainOf)
      .find((d) => d && !/linkedin\.com|crunchbase\.com|google\./i.test(d));

    return { domain, linkedinUrl, via: this.name };
  }

  // SearchAPI is a search engine, not a LinkedIn profile/roster provider.
  async getProfile(_query: ProfileQuery): Promise<Profile> {
    throw new ProviderConfigError(
      `SearchAPI does not provide LinkedIn profiles. Use the Harvest provider ` +
        `(set ENRICHMENT_PROVIDER=harvest and HARVESTAPI_KEY).`,
    );
  }

  async getEmployees(_query: EmployeesQuery): Promise<Employee[]> {
    throw new ProviderConfigError(
      `SearchAPI does not provide employee rosters. Use the Harvest provider ` +
        `(set ENRICHMENT_PROVIDER=harvest and HARVESTAPI_KEY).`,
    );
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function domainOf(url: string): string | undefined {
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, "").toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}
