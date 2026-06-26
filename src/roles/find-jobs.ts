/**
 * find-jobs — the job-first doorway into the funnel (issue 07).
 *
 * Searches the provider's Google Jobs engine (SearchAPI in production, the
 * offline FakeProvider in tests) for a query and inserts the results as `roles`.
 * Each role links to a company: if no company yet exists for the job's
 * `companyName`, one is created as `status: new`, `source: google_jobs` (an
 * unenriched stub the resolver/enricher can later fill in). Roles dedupe on the
 * provider's stable job id (`external_id`).
 *
 * This is one half of the dual-entry funnel; marking a role interesting
 * (see `markRoleInteresting`) promotes its company into the funnel and converges
 * the job-first and company-first paths.
 */
import type { CompanyRepo, RoleRepo } from "../db/repository";
import type { Company, Role } from "../db/schema";
import { fetchAtsJobs } from "../providers/ats";
import {
  ProviderConfigError,
  type EnrichmentProvider,
  type JobSearchResult,
} from "../providers/types";
import { isRelevantRole } from "./role-relevance";

export interface FindJobsOptions {
  /** Max results to request/insert (passed through to the provider). */
  limit?: number;
}

export interface FindJobsResult {
  /** Roles newly inserted this run. */
  inserted: Role[];
  /** Roles skipped because their `external_id` already existed (dedupe). */
  duplicates: Role[];
  /** Companies created as `new`/`google_jobs` stubs to host a role. */
  companiesCreated: Company[];
  /**
   * Count of candidate roles dropped as non-relevant (non-engineering or
   * explicitly junior) before dedupe/insert. See {@link isRelevantRole}.
   */
  filtered: number;
  /** Non-fatal diagnostics (e.g. provider degraded gracefully). */
  notes: string[];
}

/**
 * Run a Google Jobs search and persist the results as roles, creating/linking
 * companies as needed. All writes go through the typed data layer.
 */
export async function findJobs(
  deps: {
    provider: EnrichmentProvider;
    companies: CompanyRepo;
    roles: RoleRepo;
  },
  query: string,
  opts: FindJobsOptions = {},
): Promise<FindJobsResult> {
  const { provider, companies, roles } = deps;
  const result: FindJobsResult = {
    inserted: [],
    duplicates: [],
    companiesCreated: [],
    filtered: 0,
    notes: [],
  };

  let jobs: JobSearchResult[];
  try {
    const raw = await provider.search({ q: query, engine: "jobs", limit: opts.limit });
    jobs = raw as JobSearchResult[];
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      result.notes.push(`[${provider.name}] ${err.message}`);
      return result;
    }
    throw err;
  }

  for (const job of jobs) {
    // Drop non-engineering / explicitly-junior roles before any other work.
    if (!isRelevantRole(job.title)) {
      result.filtered += 1;
      continue;
    }

    // Dedupe on the provider's stable job id before doing any work.
    if (job.externalId) {
      const existing = await roles.findByExternalId(job.externalId);
      if (existing) {
        result.duplicates.push(existing);
        continue;
      }
    }

    const company = await findOrCreateCompany(companies, job.companyName, result);

    const role = await roles.create({
      companyId: company.id,
      title: job.title,
      url: job.link ?? null,
      location: job.location ?? null,
      workType: workTypeFromLocation(job.location),
      description: job.description ?? null,
      postedDate: job.postedDate ?? null,
      status: "new",
      source: "google_jobs",
      externalId: job.externalId ?? null,
    });
    result.inserted.push(role);
  }

  return result;
}

/**
 * Find an existing company for a job's `companyName`, or create an unenriched
 * stub (`status: new`, `source: google_jobs`) to host the role. The job-first
 * path deliberately tolerates an unresolved company — the resolver/enricher
 * fills in identity/firmographics later.
 *
 * Match is by name (case-insensitively, via slug) since a Google Jobs result
 * carries no canonical domain/linkedin identity. We never auto-merge into a
 * canonical row here; that's the resolver's job once the company is in the funnel.
 */
async function findOrCreateCompany(
  companies: CompanyRepo,
  companyName: string,
  result: FindJobsResult,
): Promise<Company> {
  const name = companyName.trim() || "Unknown";
  const slug = slugify(name);

  const existing = await companies.getBySlug(slug);
  if (existing) return existing;

  const created = await companies.create({
    slug,
    name,
    status: "new",
    source: "google_jobs",
  });
  result.companiesCreated.push(created);
  return created;
}

function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "company"
  );
}

/** Best-effort work-type inference from a free-text location string. */
function workTypeFromLocation(location?: string): "remote" | "unknown" {
  if (location && /remote/i.test(location)) return "remote";
  return "unknown";
}

// --- company-scoped harvest mode (issue #36) ---

/** Default seniority for the harvest company-scoped path (the user's taste). */
export const DEFAULT_EXPERIENCE_LEVEL = "mid-senior";

export interface FindJobsForCompanyOptions {
  /** Max results to request/insert per company. */
  limit?: number;
  /** Seniority filter; defaults to {@link DEFAULT_EXPERIENCE_LEVEL}. */
  experienceLevel?: string;
  /** Free-text job query; defaults to the empty string (all of the company's roles). */
  query?: string;
}

export interface FindJobsForCompanyResult extends FindJobsResult {
  /** True if this run resolved + persisted the company's linkedin_company_id. */
  resolvedCompanyId: boolean;
}

/**
 * Company-scoped LinkedIn Jobs search (harvest backend). For one company:
 *
 *   1. Read `companies.linkedin_company_id`. If present, skip resolution.
 *   2. If missing, resolve ONCE via the provider's company lookup and persist
 *      the returned `linkedinCompanyId` (lazy backfill). If still unknown, bail
 *      with a note (no companyId → nothing to scope by).
 *   3. Search jobs scoped to that companyId (an exact-company match, so no name
 *      stub proliferation), defaulting `experienceLevel` to mid-senior.
 *   4. Insert results via the same dedupe(external_id) → insert flow, but linked
 *      directly to THIS company (no findOrCreateCompany — the match is exact).
 *
 * All writes go through the typed data layer. A graceful provider failure is
 * captured as a note rather than thrown.
 */
export async function findJobsForCompany(
  deps: {
    provider: EnrichmentProvider;
    companies: CompanyRepo;
    roles: RoleRepo;
  },
  companyId: number,
  opts: FindJobsForCompanyOptions = {},
): Promise<FindJobsForCompanyResult> {
  const { provider, companies, roles } = deps;
  const result: FindJobsForCompanyResult = {
    inserted: [],
    duplicates: [],
    companiesCreated: [],
    filtered: 0,
    notes: [],
    resolvedCompanyId: false,
  };

  let company = await companies.get(companyId);
  if (!company) {
    result.notes.push(`no company with id ${companyId}`);
    return result;
  }

  // 1 + 2. Ensure we have the LinkedIn company id; resolve+persist once if not.
  let linkedinCompanyId = company.linkedinCompanyId ?? undefined;
  if (!linkedinCompanyId) {
    try {
      const resolution = await provider.resolveCompany({
        name: company.name,
        linkedinUrl: company.linkedinUrl ?? undefined,
        domain: company.domain ?? undefined,
        websiteUrl: company.websiteUrl ?? undefined,
        hint: company.location ?? undefined,
      });
      if (resolution.linkedinCompanyId) {
        linkedinCompanyId = resolution.linkedinCompanyId;
        company = (await companies.update(companyId, { linkedinCompanyId })) ?? company;
        result.resolvedCompanyId = true;
      }
    } catch (err) {
      if (err instanceof ProviderConfigError) {
        result.notes.push(`[${provider.name}] ${err.message}`);
        return result;
      }
      throw err;
    }
  }

  if (!linkedinCompanyId) {
    result.notes.push(
      `could not determine linkedin_company_id for "${company.name}" (#${company.id}); skipping.`,
    );
    return result;
  }

  // 3. Search jobs scoped to the exact company.
  let jobs: JobSearchResult[];
  try {
    const raw = await provider.search({
      q: opts.query ?? "",
      engine: "jobs",
      companyId: linkedinCompanyId,
      experienceLevel: opts.experienceLevel ?? DEFAULT_EXPERIENCE_LEVEL,
      limit: opts.limit,
    });
    jobs = raw as JobSearchResult[];
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      result.notes.push(`[${provider.name}] ${err.message}`);
      return result;
    }
    throw err;
  }

  // 4. Insert via dedupe(external_id) → insert, linked directly to this company.
  for (const job of jobs) {
    // Drop non-engineering / explicitly-junior roles before dedupe/insert.
    if (!isRelevantRole(job.title)) {
      result.filtered += 1;
      continue;
    }
    if (job.externalId) {
      const existing = await roles.findByExternalId(job.externalId);
      if (existing) {
        result.duplicates.push(existing);
        continue;
      }
    }
    const role = await roles.create({
      companyId: company.id,
      title: job.title,
      url: job.link ?? null,
      location: job.location ?? null,
      workType: workTypeFromLocation(job.location),
      description: job.description ?? null,
      postedDate: job.postedDate ?? null,
      status: "new",
      source: "manual",
      externalId: job.externalId ?? null,
    });
    result.inserted.push(role);
  }

  return result;
}

// --- company-scoped ATS mode (issue #40) ---

/**
 * Company-scoped ATS job search (free public board backend). For one company:
 *
 *   1. Read `companies.recruiting_website`. If absent (or not a recognized
 *      public ATS board), bail with a note — nothing to query, caller falls back.
 *   2. Pull the board's full posting list via {@link fetchAtsJobs} (no key, no
 *      cost, uncapped). A board failure degrades to `[]`, never throws.
 *   3. Insert results via the same dedupe(external_id) → insert flow as the
 *      LinkedIn path, but linked directly to THIS company and tagged
 *      `source: "ats"`.
 *
 * `fetchImpl` is injectable so tests can drive the parse without real network.
 */
export async function findJobsFromAts(
  deps: {
    companies: CompanyRepo;
    roles: RoleRepo;
    /** Injected for tests; defaults to the global `fetch` in production. */
    fetchImpl?: typeof fetch;
  },
  companyId: number,
): Promise<FindJobsResult> {
  const { companies, roles } = deps;
  const result: FindJobsResult = {
    inserted: [],
    duplicates: [],
    companiesCreated: [],
    filtered: 0,
    notes: [],
  };

  const company = await companies.get(companyId);
  if (!company) {
    result.notes.push(`no company with id ${companyId}`);
    return result;
  }
  if (!company.recruitingWebsite) {
    result.notes.push(`no recruiting_website for "${company.name}" (#${company.id}); skipping.`);
    return result;
  }

  const jobs = await fetchAtsJobs(company.recruitingWebsite, deps.fetchImpl ?? fetch);

  for (const job of jobs) {
    // Drop non-engineering / explicitly-junior roles before dedupe/insert.
    if (!isRelevantRole(job.title)) {
      result.filtered += 1;
      continue;
    }
    if (job.externalId) {
      const existing = await roles.findByExternalId(job.externalId);
      if (existing) {
        result.duplicates.push(existing);
        continue;
      }
    }
    const role = await roles.create({
      companyId: company.id,
      title: job.title,
      url: job.link ?? null,
      location: job.location ?? null,
      workType: workTypeFromLocation(job.location),
      description: job.description ?? null,
      postedDate: job.postedDate ?? null,
      status: "new",
      source: "ats",
      externalId: job.externalId ?? null,
    });
    result.inserted.push(role);
  }

  return result;
}
