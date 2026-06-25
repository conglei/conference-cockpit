import type {
  CompanyQuery,
  CompanyResolution,
  Employee,
  EmployeesQuery,
  EnrichmentProvider,
  JobSearchResult,
  Profile,
  ProfileQuery,
  SearchQuery,
  SearchResult,
  WebSearchResult,
} from "./types";

/**
 * Shape of the canned fixtures that drive the FakeProvider. Every field is
 * optional so a test can inject only what it needs; anything missing falls back
 * to a deterministic synthesized value.
 */
export interface FakeFixtures {
  /** Keyed by lower-cased company name. */
  companies?: Record<string, CompanyResolution>;
  /** Keyed by LinkedIn profile URL. */
  profiles?: Record<string, Profile>;
  /** Keyed by company LinkedIn URL. */
  employees?: Record<string, Employee[]>;
  /** Keyed by `${engine}:${q}` (q lower-cased). */
  search?: Record<string, SearchResult[]>;
}

/** Built-in fixtures so the provider is useful with zero configuration. */
const DEFAULT_FIXTURES: Required<FakeFixtures> = {
  companies: {
    anthropic: {
      domain: "anthropic.com",
      linkedinUrl: "https://www.linkedin.com/company/anthropicresearch",
      description: "AI safety and research company.",
      sizeBand: "mid",
      via: "fake",
    },
    giga: {
      domain: "giga.com",
      linkedinUrl: "https://www.linkedin.com/company/gigaml",
      description: "AI support agents for enterprises.",
      sizeBand: "tiny",
      via: "fake",
    },
  },
  profiles: {
    "https://www.linkedin.com/in/jane-founder": {
      name: "Jane Founder",
      linkedinUrl: "https://www.linkedin.com/in/jane-founder",
      title: "Co-founder & CEO",
      company: "Giga",
      location: "San Francisco, CA",
    },
  },
  employees: {
    "https://www.linkedin.com/company/gigaml": [
      {
        name: "Jane Founder",
        linkedinUrl: "https://www.linkedin.com/in/jane-founder",
        title: "Co-founder & CEO",
        location: "San Francisco, CA",
      },
      {
        name: "Sam Engineer",
        linkedinUrl: "https://www.linkedin.com/in/sam-engineer",
        title: "Founding Engineer",
        location: "San Francisco, CA",
      },
    ],
  },
  search: {
    "web:giga linkedin": [
      {
        title: "Giga | LinkedIn",
        link: "https://www.linkedin.com/company/gigaml",
        snippet: "Giga builds AI support agents.",
      },
    ],
    "jobs:founding engineer": [
      {
        title: "Founding Engineer",
        companyName: "Giga",
        location: "San Francisco, CA",
        link: "https://startups.gallery/companies/gigaml/jobs/1",
        externalId: "giga-fe-1",
        postedDate: "2026-06-20",
        description: "Build the core agent platform.",
      },
    ],
  },
};

/**
 * Offline, deterministic provider returning canned fixtures. This is the
 * primary test seam (PRD "Testing Decisions"): the whole source → enrich →
 * score pipeline runs against it with zero network and zero API spend.
 *
 * For inputs not present in the fixtures it synthesizes a stable, derived
 * answer (e.g. a domain/LinkedIn slug from the company name) so callers always
 * get a usable, repeatable result.
 */
export class FakeProvider implements EnrichmentProvider {
  readonly name = "fake";
  private readonly fx: Required<FakeFixtures>;

  constructor(fixtures: FakeFixtures = {}) {
    this.fx = {
      companies: { ...DEFAULT_FIXTURES.companies, ...fixtures.companies },
      profiles: { ...DEFAULT_FIXTURES.profiles, ...fixtures.profiles },
      employees: { ...DEFAULT_FIXTURES.employees, ...fixtures.employees },
      search: { ...DEFAULT_FIXTURES.search, ...fixtures.search },
    };
  }

  async resolveCompany(query: CompanyQuery): Promise<CompanyResolution> {
    const key = query.name.trim().toLowerCase();
    const hit = this.fx.companies[key];
    if (hit) return hit;

    // Synthesize a deterministic resolution from the name (or a known domain).
    const slug = slugify(query.name);
    const domain = query.domain ?? domainFromWebsite(query.websiteUrl) ?? `${slug}.com`;
    const linkedinUrl =
      query.linkedinUrl ?? `https://www.linkedin.com/company/${slug}`;
    return { domain, linkedinUrl, via: "fake" };
  }

  async getProfile(query: ProfileQuery): Promise<Profile> {
    const hit = this.fx.profiles[query.linkedinUrl];
    if (hit) return hit;
    return {
      name: nameFromLinkedin(query.linkedinUrl),
      linkedinUrl: query.linkedinUrl,
    };
  }

  async getEmployees(query: EmployeesQuery): Promise<Employee[]> {
    const hit = this.fx.employees[query.companyLinkedinUrl] ?? [];
    return query.limit ? hit.slice(0, query.limit) : hit;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const key = `${query.engine}:${query.q.trim().toLowerCase()}`;
    const hit = this.fx.search[key] ?? [];
    return query.limit ? hit.slice(0, query.limit) : hit;
  }
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function domainFromWebsite(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

function nameFromLinkedin(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/);
  if (!m) return "Unknown";
  return m[1]
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Re-export so tests/utilities can build narrow result types ergonomically.
export type { WebSearchResult, JobSearchResult };
