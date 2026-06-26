import pRetry, { AbortError, type Options as RetryOptions } from "p-retry";
import { cacheKey, getResponseCache, readBody, type ResponseCache } from "./cache";
import { CostMeter } from "./cost";
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
} from "./types";

const BASE_URL = "https://api.harvest-api.com";
const KEY_ENV = "HARVESTAPI_KEY";

/**
 * Role terms used to roster a company's founders/key people. They are OR-ed into
 * a single `title` query (profile-search honours a space-delimited `OR`, so this
 * is one call, not one per term). `founder` also matches `co-founder`; `ceo`/
 * `cto` catch founder-execs whose headline leads with the C-title. Widen this
 * list to capture more leadership roles.
 */
const FOUNDER_TITLES = ["founder", "ceo", "cto"] as const;

/** Founder/key-person title test, applied to a profile-search `position` line. */
const FOUNDER_TITLE_RE = /\b(co-?founder|founder|ceo|cto|chief|president)\b/i;

/** Words that mark a position line as an investor/advisor rather than an operator. */
const INVESTOR_RE = /\b(ventures?|capital|partners?|general partner|managing (partner|director)|\bLP\b|investor|angel|board (member|advisor|director))\b/i;

/**
 * HarvestAPI adapter — LinkedIn company profiles, person profiles, and company
 * employee rosters over plain HTTP (no LinkedIn cookies). Coded to the live API
 * shape; thin by design. Reads its key from `HARVESTAPI_KEY` in `.env.local`
 * and degrades gracefully (ProviderConfigError naming the env var) when the key
 * is missing or a call fails.
 *
 * Live shape (verified against api.harvest-api.com, free tier):
 *   - GET /linkedin/company?url=|universalName=|companyId=  → { element: {...} }
 *   - GET /linkedin/company-search?search=                  → { elements: [...] }
 *   - GET /linkedin/profile?url=|publicIdentifier=          → { element: {...} }
 *   - GET /linkedin/profile-search?currentCompanyId=        → { elements: [...] }
 * Single-entity responses wrap the payload under `element`; searches under
 * `elements`. Employees are not a dedicated endpoint — they are a profile
 * search filtered by the company's numeric id (resolved first from its URL).
 */
export class HarvestProvider implements EnrichmentProvider {
  readonly name = "harvest";
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly meter: CostMeter | undefined;
  private readonly retry: RetryOptions;
  private readonly cache: ResponseCache;

  constructor(
    opts: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      meter?: CostMeter;
      /** Backoff tuning (mostly for tests); defaults to 5 retries, ~0.5s→20s. */
      retry?: RetryOptions;
      /** Response cache (defaults to the process singleton; tests inject one). */
      cache?: ResponseCache;
    } = {},
  ) {
    this.apiKey = opts.apiKey ?? process.env[KEY_ENV];
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.meter = opts.meter;
    this.retry = { retries: 5, factor: 2, minTimeout: 500, maxTimeout: 20_000, ...opts.retry };
    this.cache = opts.cache ?? getResponseCache();
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderConfigError(
        `HarvestAPI is not configured: set ${KEY_ENV} in .env.local to enable LinkedIn ` +
          `company/profile/employee enrichment (or set ENRICHMENT_PROVIDER=fake to run offline).`,
      );
    }
    return this.apiKey;
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const key = this.requireKey();
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    // Cache HIT: return the stored body without any network call, retry, or
    // meter cost (cache hits are free).
    const ck = cacheKey(this.name, "GET", url.toString());
    const hit = await this.cache.get(ck);
    if (hit) return JSON.parse(hit.response);

    // Retry transient failures (429 rate-limit, 5xx, network) with exponential
    // backoff; abort immediately on a real config error (4xx like 404/401) so we
    // don't waste retries on something that will never succeed. p-retry owns the
    // backoff schedule — no hand-rolled sleep loop.
    const res = await pRetry(async () => {
      let r: Response;
      try {
        r = await this.fetchImpl(url.toString(), {
          headers: { "X-API-Key": key, Accept: "application/json" },
        });
      } catch (cause) {
        throw new Error(`HarvestAPI request to ${path} failed (network error): ${String(cause)}`);
      }
      if (r.status === 429 || r.status >= 500) {
        throw new Error(`HarvestAPI ${path} returned ${r.status} ${r.statusText} (retrying)`);
      }
      if (!r.ok) {
        throw new AbortError(
          new ProviderConfigError(
            `HarvestAPI request to ${path} returned ${r.status} ${r.statusText}. ` +
              `Verify ${KEY_ENV} in .env.local and your plan/quota.`,
          ),
        );
      }
      return r;
    }, this.retry);

    // MISS on a 2xx: store the raw text, bill the call, return the parsed JSON.
    const text = await readBody(res);
    await this.cache.set(ck, {
      provider: this.name,
      request: ck,
      response: text,
      status: res.status,
    });
    // Only successful calls are billed.
    this.meter?.recordPath(path);
    return JSON.parse(text);
  }

  /** Fetch a company `element`, by LinkedIn URL when known, else by name search. */
  private async companyElement(query: CompanyQuery): Promise<Record<string, unknown> | undefined> {
    if (query.linkedinUrl) {
      const data = (await this.get("/linkedin/company", {
        url: query.linkedinUrl,
      })) as Record<string, unknown>;
      const el = element(data);
      if (el) return el;
    }
    // No URL (or URL miss): search by name and take the top hit, then fetch the
    // full company record by its universalName to get website/headcount (the
    // lean search result omits those).
    if (query.name) {
      const search = (await this.get("/linkedin/company-search", {
        search: query.name,
        pageSize: "1",
      })) as Record<string, unknown>;
      const hit = firstElement(search);
      const universalName = asString(hit?.universalName);
      if (universalName) {
        const data = (await this.get("/linkedin/company", {
          universalName,
        })) as Record<string, unknown>;
        return element(data) ?? hit;
      }
      return hit;
    }
    return undefined;
  }

  async resolveCompany(query: CompanyQuery): Promise<CompanyResolution> {
    const el = await this.companyElement(query);
    if (!el) return { via: this.name };
    const website = asString(el.website);
    return {
      domain: website ? domainOf(website) : undefined,
      linkedinUrl: asString(el.linkedinUrl),
      // The company element already carries the numeric id (getEmployees reads
      // it too); surface it as a durable canonical identifier — stringified the
      // same way getEmployees does, so a numeric `id` still comes through.
      linkedinCompanyId: idString(el.id),
      description: asString(el.tagline) ?? asString(el.description),
      sizeBand: bandFromHeadcount(asNumber(el.employeeCount)),
      via: this.name,
    };
  }

  async getProfile(query: ProfileQuery): Promise<Profile> {
    const data = (await this.get("/linkedin/profile", {
      url: query.linkedinUrl,
    })) as Record<string, unknown>;
    const el = element(data) ?? data;
    const name =
      [asString(el.firstName), asString(el.lastName)].filter(Boolean).join(" ") ||
      asString(el.name) ||
      "Unknown";
    return {
      name,
      linkedinUrl: query.linkedinUrl,
      title: asString(el.headline) ?? positionOf(el.currentPosition),
      company: companyNameOf(el.currentPosition),
      location: locationText(el.location),
      currentCompanies: currentCompaniesOf(el.currentPosition),
      raw: el,
    };
  }

  /**
   * Roster the company's founders/key people — cheap and triage-only.
   *
   * profile-search's `currentCompany` + `title` are *fuzzy ranking signals*, not
   * hard filters: scoped to company X they still surface investors ("General
   * Partner at <VC>") and other-company founders ("Founder @ <OtherCo>"). The
   * authoritative signal is the person's profile `currentPosition[].companyId`,
   * but a profile fetch is the priciest call — so this method NEVER fetches
   * profiles. It does ONE cheap search and triages by headline:
   *
   *   - ONE search — all role terms OR-ed into a single `title` query
   *     (`founder OR ceo OR cto`); the API honours a space-delimited `OR`, so
   *     this replaces N per-title calls with one.
   *   - Confirmed — headline is a founder/exec line that NAMES this company
   *     ("Co-Founder & CEO at Acme") → `confirmed: true`, no further check.
   *   - Dropped — headline names a clearly different employer/investor.
   *   - Unconfirmed — a custom tagline ("Building AI for science") that names
   *     no company → returned with `confirmed: false` and the company id, for
   *     the enrich step to verify using the profile it fetches for storage
   *     ANYWAY. Verification thus costs zero extra calls.
   */
  async getEmployees(query: EmployeesQuery): Promise<Employee[]> {
    const company = await this.companyElement({
      name: "",
      linkedinUrl: query.companyLinkedinUrl,
    });
    const companyId = idString(company?.id);
    if (!companyId) return [];
    const companyName = asString(company?.name);

    let data: unknown;
    try {
      data = await this.get("/linkedin/profile-search", {
        currentCompany: companyId,
        title: FOUNDER_TITLES.join(" OR "),
        pageSize: String(query.limit ?? 10),
      });
    } catch {
      return [];
    }

    const seen = new Set<string>();
    const out: Employee[] = [];
    for (const el of elements(data)) {
      const url = asString(el.linkedinUrl) ?? asString(el.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const position = asString(el.position) ?? "";
      const isExecTitle = FOUNDER_TITLE_RE.test(position);
      const names = mentionsCompany(position, companyName);
      // Drop: not an exec line AND it points at another org → certain noise.
      if (!isExecTitle && namesAnotherCompany(position, companyName)) continue;
      // Confirmed: exec line that names this company.
      if (isExecTitle && names) {
        out.push(toEmployee(url, el, position, locationText(el.location), companyId, true));
        continue;
      }
      // Drop: exec line that clearly names a *different* company.
      if (isExecTitle && namesAnotherCompany(position, companyName)) continue;
      // Unconfirmed: a company-less tagline — let enrich verify on its storage fetch.
      out.push(toEmployee(url, el, position, locationText(el.location), companyId, false));
    }
    return out;
  }

  /**
   * Jobs search — HarvestAPI's LinkedIn Jobs engine. Only the `jobs` engine is
   * supported (HarvestAPI is not a Google web search engine); `web` still throws
   * an actionable config error pointing at SearchAPI.
   *
   * `GET /linkedin/job-search` with `search` (the free-text query) plus the
   * optional scoping params we expose: `companyId` (exact-company postings),
   * `experienceLevel`, `location`, and `page`. Each result element maps to the
   * shared {@link JobSearchResult}; we read defensively against the live shape
   * (company name under `company.name`, location under `location.linkedinText`).
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (query.engine !== "jobs") {
      throw new ProviderConfigError(
        `HarvestAPI does not provide web search. Use the SearchAPI provider ` +
          `(set ENRICHMENT_PROVIDER=searchapi and SEARCHAPI_KEY) for Google web search.`,
      );
    }

    const params: Record<string, string> = { search: query.q };
    if (query.companyId) params.companyId = query.companyId;
    if (query.experienceLevel) params.experienceLevel = query.experienceLevel;
    if (query.location) params.location = query.location;
    if (query.page) params.page = String(query.page);

    const data = await this.get("/linkedin/job-search", params);
    const out: JobSearchResult[] = elements(data).map((el) => {
      const company = el.company && typeof el.company === "object"
        ? (el.company as Record<string, unknown>)
        : undefined;
      return {
        title: asString(el.title) ?? "",
        companyName: asString(company?.name) ?? "",
        location: locationText(el.location),
        link: asString(el.url) ?? asString(el.link),
        externalId: idString(el.id),
        postedDate: asString(el.postedDate) ?? asString(el.postedAt),
        description: asString(el.description),
      };
    });
    return query.limit ? out.slice(0, query.limit) : out;
  }
}

/** Distinctive lowercase tokens of a company name (drops generic suffixes). */
function companyTokens(name?: string): string[] {
  if (!name) return [];
  const stop = new Set(["labs", "lab", "ai", "inc", "co", "the", "technologies", "tech", "io", "hq"]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/&/g, "").trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

/** Does a position line reference this company (by full name or a distinctive token)? */
function mentionsCompany(position: string, name?: string): boolean {
  if (!name) return false;
  const p = position.toLowerCase();
  if (p.includes(name.toLowerCase().replace(/&/g, "").trim())) return true;
  return companyTokens(name).some((t) => p.includes(t));
}

/**
 * Does the line clearly belong to a *different* org — i.e. it points at another
 * employer ("… at X", "@ X", "of X") or is an investor/advisor line — without
 * naming this company? Such candidates are dropped without a profile fetch.
 */
function namesAnotherCompany(position: string, name?: string): boolean {
  if (mentionsCompany(position, name)) return false;
  return INVESTOR_RE.test(position) || /(^|\s)(at|@|of)\s+[A-Za-z0-9]/.test(position);
}

function toEmployee(
  url: string,
  el: Record<string, unknown>,
  title: string,
  location: string | undefined,
  companyId: string,
  confirmed: boolean,
): Employee {
  return {
    name:
      asString(el.name) ??
      ([asString(el.firstName), asString(el.lastName)].filter(Boolean).join(" ") || "Unknown"),
    linkedinUrl: url,
    title: title || asString(el.position) || asString(el.headline),
    location,
    companyId,
    confirmed,
  };
}

/** Normalize a profile's `currentPosition[]` into the structured verify shape. */
function currentCompaniesOf(v: unknown): Profile["currentCompanies"] {
  if (!Array.isArray(v)) return undefined;
  return (v as Record<string, unknown>[]).map((p) => ({
    companyId: asString(p.companyId) ?? (p.companyId != null ? String(p.companyId) : undefined),
    companyName: asString(p.companyName),
    title: asString(p.position),
  }));
}

/** Single-entity responses wrap the payload under `element`. */
function element(data: unknown): Record<string, unknown> | undefined {
  if (data && typeof data === "object" && "element" in data) {
    const el = (data as { element: unknown }).element;
    return el && typeof el === "object" ? (el as Record<string, unknown>) : undefined;
  }
  return undefined;
}

/** Search responses wrap rows under `elements`. */
function elements(data: unknown): Record<string, unknown>[] {
  if (data && typeof data === "object" && "elements" in data) {
    const els = (data as { elements: unknown }).elements;
    if (Array.isArray(els)) return els as Record<string, unknown>[];
  }
  return [];
}

function firstElement(data: unknown): Record<string, unknown> | undefined {
  return elements(data)[0];
}

/** `currentPosition`/`currentCompany` come back as an array of position objects. */
function positionOf(v: unknown): string | undefined {
  const first = Array.isArray(v) ? (v[0] as Record<string, unknown>) : undefined;
  return first ? asString(first.position) : undefined;
}

function companyNameOf(v: unknown): string | undefined {
  const first = Array.isArray(v) ? (v[0] as Record<string, unknown>) : undefined;
  return first ? asString(first.companyName) : undefined;
}

/** `location` is an object like `{ linkedinText, parsed: {...} }`. */
function locationText(v: unknown): string | undefined {
  if (typeof v === "string") return asString(v);
  if (v && typeof v === "object" && "linkedinText" in v) {
    return asString((v as { linkedinText: unknown }).linkedinText);
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Stringify a LinkedIn id that may arrive as a string OR a number (`id: 777`). */
function idString(v: unknown): string | undefined {
  return asString(v) ?? (v != null && typeof v !== "object" ? String(v) : undefined);
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

/** Bucket a headcount into the size bands ADR-0001 uses for scoring. */
function bandFromHeadcount(n?: number): string | undefined {
  if (n === undefined) return undefined;
  if (n <= 20) return "tiny";
  if (n <= 100) return "small";
  if (n <= 1000) return "mid";
  return "large";
}
