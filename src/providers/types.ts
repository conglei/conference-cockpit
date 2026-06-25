/**
 * The EnrichmentProvider seam — the single interface through which ALL external
 * data flows (see PRD "Providers — pluggable EnrichmentProvider interface" and
 * "Testing Decisions"). Real adapters (HarvestAPI, SearchAPI) and the offline
 * FakeProvider all implement this shape, so swapping providers is a config
 * change, not a code change.
 *
 * Conceptual methods:
 *  - resolveCompany — given what we know about a company, return its canonical
 *                     domain + LinkedIn URL (the dedupe identity, ADR-0001).
 *  - getProfile     — fetch a single person/founder profile by LinkedIn URL.
 *  - getEmployees   — fetch a company's employee roster (referrer discovery).
 *  - search         — web search (Google) + Google Jobs.
 */

// --- resolveCompany ---

/** What we already know about a company going into resolution. */
export interface CompanyQuery {
  name: string;
  /** Raw website if known (may be a marketing/aggregator URL). */
  websiteUrl?: string;
  domain?: string;
  linkedinUrl?: string;
  /** Free-text hint (location, category…) to disambiguate common names. */
  hint?: string;
}

/** The canonical identity a provider resolved for a company. */
export interface CompanyResolution {
  /** Canonical apex domain, e.g. "anthropic.com" (lower-cased, no scheme). */
  domain?: string;
  /** Canonical LinkedIn company URL, e.g. "https://www.linkedin.com/company/anthropic". */
  linkedinUrl?: string;
  /**
   * LinkedIn's numeric company id (stringified), e.g. "1815218" — a durable
   * canonical identifier the provider already has on the company element. Lets
   * company-scoped job search address LinkedIn by id without re-resolving.
   */
  linkedinCompanyId?: string;
  /** Optional firmographics a provider may also return while resolving. */
  description?: string;
  /** Bucketed headcount band (tiny/small/mid/large) when known. */
  sizeBand?: string;
  /** Fine-grained industry label (Apollo `industry`). */
  industry?: string;
  /** Self-described focus terms (Apollo `keywords[]`), as a JSON array string. */
  keywords?: string;
  /** Headquarters location, composed from city/state/country. */
  location?: string;
  /** Founding year (Apollo `founded_year`). */
  foundedYear?: number;
  /** Raw headcount (Apollo `estimated_num_employees`); `sizeBand` is its bucket. */
  headcount?: number;
  /** Raw provider response (JSON string) to persist into `enrichment_blob`. */
  raw?: string;
  /** Latest funding round name, e.g. "Series F" (Apollo `latest_funding_stage`). */
  latestRound?: string;
  /** Latest round amount with currency, e.g. "$1.5B". */
  latestAmount?: string;
  /** Date of the latest funding event, sliced to `YYYY-MM-DD`. */
  lastFundingDate?: string;
  /** Lead investor(s) for the latest round (comma-string). */
  leadInvestor?: string;
  /** Cumulative funding raised, e.g. "$2.1B" (Apollo `total_funding_printed`). */
  fundingTotal?: string;
  /** Where this resolution came from (provider name or "web-search"). */
  via: string;
}

// --- getProfile ---

export interface ProfileQuery {
  linkedinUrl: string;
  /**
   * Opaque provider-side person id (e.g. Apollo's `person.id` from a people
   * search). When present, a provider that can reveal a masked roster entry by
   * id (Apollo `people/match`) uses it instead of the LinkedIn URL — Apollo
   * cannot fetch a deep profile from an arbitrary LinkedIn URL.
   */
  providerId?: string;
}

export interface Profile {
  name: string;
  linkedinUrl: string;
  title?: string;
  company?: string;
  location?: string;
  /**
   * The person's current positions, normalized for verification — used to
   * confirm a candidate actually lists a given company id as a current employer
   * (and to read their real title there) without re-parsing {@link raw}.
   */
  currentCompanies?: Array<{ companyId?: string; companyName?: string; title?: string }>;
  /** Raw provider payload, stored verbatim in people.enrichment_blob. */
  raw?: unknown;
}

// --- getEmployees ---

export interface EmployeesQuery {
  /** Canonical LinkedIn company URL to roster. */
  companyLinkedinUrl: string;
  /**
   * Canonical apex domain — the domain-first roster key (ADR-0003 §2). Domain-keyed
   * providers (e.g. Apollo people-search) roster by this instead of a LinkedIn URL.
   */
  domain?: string;
  limit?: number;
}

export interface Employee {
  name: string;
  linkedinUrl?: string;
  title?: string;
  location?: string;
  /**
   * The numeric LinkedIn id of the company this person was rostered for. Lets
   * the enrich step confirm an unconfirmed candidate against their profile's
   * current positions (and pick their real title there) using the one profile
   * fetch it makes anyway — no separate verification call.
   */
  companyId?: string;
  /**
   * Opaque provider-side person id from the roster (e.g. Apollo's `person.id`).
   * Lets a later `getProfile` reveal a masked roster entry (Apollo's
   * `people/match`, keyed by this id, returns the full name + LinkedIn URL).
   */
  providerId?: string;
  /**
   * True when the roster already established this person is at the company
   * (their search headline named it). False/undefined means "verify against the
   * profile before trusting." Lets cheap, certain cases skip verification.
   */
  confirmed?: boolean;
}

// --- search ---

export type SearchEngine = "web" | "jobs";

export interface SearchQuery {
  q: string;
  engine: SearchEngine;
  limit?: number;
  /**
   * Scope a jobs search to a single LinkedIn company by its numeric id (harvest
   * `/linkedin/job-search?companyId=`). When set, results are that company's
   * postings only — an exact company match, no name-based stub proliferation.
   * Ignored by the SearchAPI google/jobs paths.
   */
  companyId?: string;
  /**
   * Seniority filter for a jobs search (harvest `experienceLevel`), e.g.
   * "mid-senior". Ignored by the SearchAPI paths.
   */
  experienceLevel?: string;
  /** Location filter for a jobs search (harvest `location`). */
  location?: string;
  /** 1-based result page for a paginated jobs search (harvest `page`). */
  page?: number;
}

export interface WebSearchResult {
  title: string;
  link: string;
  snippet?: string;
}

export interface JobSearchResult {
  title: string;
  companyName: string;
  location?: string;
  link?: string;
  /** Provider's stable job id, used for role dedupe (roles.external_id). */
  externalId?: string;
  postedDate?: string;
  description?: string;
}

export type SearchResult = WebSearchResult | JobSearchResult;

// --- the interface ---

export interface EnrichmentProvider {
  /** Stable identifier, e.g. "fake" | "harvest" | "searchapi". */
  readonly name: string;

  resolveCompany(query: CompanyQuery): Promise<CompanyResolution>;
  getProfile(query: ProfileQuery): Promise<Profile>;
  getEmployees(query: EmployeesQuery): Promise<Employee[]>;
  search(query: SearchQuery): Promise<SearchResult[]>;
}

/**
 * Thrown when a provider cannot operate because configuration is missing
 * (e.g. an API key) or a capability is unsupported. The message must name
 * exactly what to configure so the pipeline can degrade gracefully with an
 * actionable readout (PRD user-story 19).
 */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}
