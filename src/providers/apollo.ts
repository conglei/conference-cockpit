import { cacheKey, getResponseCache, readBody, type ResponseCache } from "./cache";
import { CostMeter } from "./cost";
import {
  ProviderConfigError,
  type CompanyQuery,
  type CompanyResolution,
  type Employee,
  type EmployeesQuery,
  type EnrichmentProvider,
  type Profile,
  type ProfileQuery,
  type SearchQuery,
  type SearchResult,
} from "./types";

const BASE_URL = "https://api.apollo.io";
const KEY_ENV = "APOLLO_KEY";

/**
 * Founder/key-person titles used to roster a company's founders via Apollo
 * people-search. Apollo's `person_titles` is OR-ed server-side, so this is one
 * call. Widen this list to capture more leadership roles.
 */
const FOUNDER_TITLES = ["Founder", "Co-Founder", "CEO", "CTO"] as const;

/**
 * Apollo.io adapter — DOMAIN-FIRST company identity + founder roster (ADR-0003
 * §1–2). Apollo's natural key is a company DOMAIN, which is exactly the anchor
 * the domain-first design resolves before any LinkedIn/founder lookup, so Apollo
 * slots in as the cheap identity/firmographics + free founder-roster rung of the
 * recovery ladder. Reads its key from `APOLLO_KEY` in `.env.local` and degrades
 * gracefully (ProviderConfigError naming the env var) when the key is missing.
 *
 * Live shape (Apollo REST, base https://api.apollo.io, header `X-Api-Key`):
 *   - GET  /api/v1/organizations/enrich?domain=<domain>  → { organization: {...} }
 *   - POST /api/v1/mixed_people/search                    → { people: [...] }
 * Apollo is identity + roster only: deep per-founder profiles come from the
 * HarvestAPI provider, and Apollo is not a web/jobs search engine.
 */
export class ApolloProvider implements EnrichmentProvider {
  readonly name = "apollo";
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
        `Apollo is not configured: set ${KEY_ENV} in .env.local to enable domain-first ` +
          `company identity + founder roster (or set ENRICHMENT_PROVIDER=fake to run offline).`,
      );
    }
    return this.apiKey;
  }

  /**
   * Issue an Apollo request and parse JSON. Apollo bills in credits per call;
   * only successful calls are recorded on the meter (placeholder ~0.01 USD each).
   */
  private async request(
    method: "GET" | "POST",
    path: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const key = this.requireKey();
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    // Cache HIT: return the stored body without hitting the network or the meter
    // (cache hits are free). The key folds in method + URL + body.
    const ck = cacheKey(this.name, method, url.toString(), init.body);
    const hit = this.cache.get(ck);
    if (hit) return JSON.parse(hit.response);

    let r: Response;
    try {
      r = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          "X-Api-Key": key,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (cause) {
      throw new Error(`Apollo request to ${path} failed (network error): ${String(cause)}`);
    }
    if (!r.ok) {
      throw new ProviderConfigError(
        `Apollo request to ${path} returned ${r.status} ${r.statusText}. ` +
          `Verify ${KEY_ENV} in .env.local and your plan/credits.`,
      );
    }
    // MISS on a 2xx: store the raw text, bill the call, return the parsed JSON.
    const text = await readBody(r);
    this.cache.set(ck, {
      provider: this.name,
      request: ck,
      response: text,
      status: r.status,
    });
    // Only successful calls are billed.
    this.meter?.record("apollo");
    return JSON.parse(text);
  }

  /** Domain to roster/resolve by: explicit `domain`, else derived from a website URL. */
  private domainFor(query: CompanyQuery): string | undefined {
    return query.domain ?? (query.websiteUrl ? domainOf(query.websiteUrl) : undefined);
  }

  async resolveCompany(query: CompanyQuery): Promise<CompanyResolution> {
    const domain = this.domainFor(query);
    if (!domain) return { via: this.name };

    const data = (await this.request("GET", "/api/v1/organizations/enrich", {
      query: { domain },
    })) as { organization?: Record<string, unknown> };
    const org = data.organization;
    if (!org) return { via: this.name };

    return {
      domain: asString(org.primary_domain) ?? domain,
      linkedinUrl: asString(org.linkedin_url),
      description: asString(org.short_description),
      sizeBand: bandFromHeadcount(asNumber(org.estimated_num_employees)),
      ...fundingFrom(org),
      via: this.name,
    };
  }

  /**
   * Roster the company's founders via Apollo people-search, keyed by DOMAIN
   * (the domain-first roster anchor). No domain → no roster.
   */
  async getEmployees(query: EmployeesQuery): Promise<Employee[]> {
    const domain = query.domain;
    if (!domain) return [];

    // `mixed_people/search` is deprecated for API callers; the live endpoint is
    // `mixed_people/api_search`. Search results MASK the last name
    // (`last_name_obfuscated`) and omit `linkedin_url` — full data needs a
    // (billable) people-enrichment call, so the roster carries first name +
    // title; the deep profile comes from the harvest provider.
    const data = (await this.request("POST", "/api/v1/mixed_people/api_search", {
      body: {
        q_organization_domains_list: [domain],
        person_titles: [...FOUNDER_TITLES],
        page: 1,
        per_page: query.limit ?? 10,
      },
    })) as { people?: Record<string, unknown>[] };

    const people = Array.isArray(data.people) ? data.people : [];
    const out: Employee[] = [];
    for (const person of people) {
      const last = asString(person.last_name) ?? asString(person.last_name_obfuscated);
      const name =
        asString(person.name) ??
        ([asString(person.first_name), last].filter(Boolean).join(" ") || "Unknown");
      out.push({
        name,
        linkedinUrl: asString(person.linkedin_url),
        title: asString(person.title),
        location: locationOf(person),
        // The masked-search person id — the only key that reveals the full name
        // + LinkedIn via `people/match` in getProfile.
        providerId: asString(person.id),
      });
    }
    return out;
  }

  /**
   * Reveal a masked roster entry via Apollo `people/match` (1 credit), keyed by
   * the search-side `person.id` carried on the Employee as `providerId`. People
   * search returns founders masked (`last_name_obfuscated`, no LinkedIn); only
   * this id-keyed match returns the full name + `linkedin_url`. Apollo CANNOT
   * fetch a deep profile from an arbitrary LinkedIn URL, so with no providerId
   * there is nothing to reveal — keep degrading via ProviderConfigError so the
   * deep-profile rung stays the harvest provider's job.
   */
  async getProfile(query: ProfileQuery): Promise<Profile> {
    if (!query.providerId) {
      throw new ProviderConfigError(
        "Apollo can only reveal a profile by its people-search id (providerId); it cannot fetch a " +
          "deep profile from a LinkedIn URL. Deep per-founder profiles come from the harvest provider " +
          "(set ENRICHMENT_PROVIDER=harvest and HARVESTAPI_KEY).",
      );
    }

    const data = (await this.request("POST", "/api/v1/people/match", {
      body: { id: query.providerId },
    })) as { person?: Record<string, unknown> };
    const person = data.person ?? {};

    const org = person.organization as Record<string, unknown> | undefined;
    return {
      name: asString(person.name) ?? "Unknown",
      linkedinUrl: asString(person.linkedin_url) ?? query.linkedinUrl,
      title: asString(person.title),
      company: asString(org?.name),
      location: locationOf(person),
      raw: person,
    };
  }

  // Apollo is identity + roster only, not a web/jobs search engine.
  async search(_query: SearchQuery): Promise<SearchResult[]> {
    throw new ProviderConfigError(
      "Apollo does not provide web/jobs search. Use the SearchAPI provider " +
        "(set ENRICHMENT_PROVIDER=searchapi and SEARCHAPI_KEY) for Google web + Google Jobs.",
    );
  }
}

/**
 * Parse funding firmographics off an Apollo org-enrich object (verified live
 * shapes). `latest_funding_stage` is the round name; the MOST RECENT
 * `funding_events[]` element (max `date`) gives the amount (`currency + amount`,
 * e.g. "$1.5B"), the lead investor(s) (comma-string), and the funding date
 * (sliced to `YYYY-MM-DD`); `total_funding_printed` is the running total
 * (prefixed "$"). Missing pieces are simply omitted — defensive against partial
 * org objects.
 */
function fundingFrom(org: Record<string, unknown>): {
  latestRound?: string;
  latestAmount?: string;
  lastFundingDate?: string;
  leadInvestor?: string;
  fundingTotal?: string;
} {
  const out: ReturnType<typeof fundingFrom> = {};

  const round = asString(org.latest_funding_stage);
  if (round) out.latestRound = round;

  // Most-recent event by date; the round-level date is the fallback.
  const events = Array.isArray(org.funding_events)
    ? (org.funding_events as Record<string, unknown>[])
    : [];
  let latest: Record<string, unknown> | undefined;
  for (const e of events) {
    const d = asString(e.date);
    if (!latest || (d && (asString(latest.date) ?? "") < d)) latest = e;
  }
  if (latest) {
    const currency = asString(latest.currency) ?? "";
    const amount = asString(latest.amount);
    if (amount) out.latestAmount = `${currency}${amount}`;
    const investors = asString(latest.investors);
    if (investors) out.leadInvestor = investors;
  }
  const date = asString(latest?.date) ?? asString(org.latest_funding_round_date);
  if (date) out.lastFundingDate = date.slice(0, 10);

  const total = asString(org.total_funding_printed);
  if (total) out.fundingTotal = `$${total}`;

  return out;
}

/** Compose a location string from Apollo's city/state/country person fields. */
function locationOf(person: Record<string, unknown>): string | undefined {
  const parts = [asString(person.city), asString(person.state), asString(person.country)].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function domainOf(url: string): string | undefined {
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, "").toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bucket a headcount into the size bands ADR-0001 uses for scoring. Duplicated
 * from the harvest provider (each adapter owns its own thin mapping helpers).
 */
function bandFromHeadcount(n?: number): string | undefined {
  if (n === undefined) return undefined;
  if (n <= 20) return "tiny";
  if (n <= 100) return "small";
  if (n <= 1000) return "mid";
  return "large";
}
