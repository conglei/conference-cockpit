import { describe, it, expect, beforeEach } from "vitest";
import {
  createCompanyRepo,
  createRoleRepo,
  type CompanyRepo,
  type RoleRepo,
} from "../src/db/repository";
import { FakeProvider } from "../src/providers/fake";
import type {
  CompanyQuery,
  CompanyResolution,
  EnrichmentProvider,
  JobSearchResult,
  SearchQuery,
  SearchResult,
} from "../src/providers/types";
import { findJobs, findJobsForCompany } from "../src/roles/find-jobs";
import { markRoleInteresting } from "../src/roles/mark-interesting";
import { createTestDb } from "./helpers";

/** Build a FakeProvider whose `jobs:<q>` search returns the given results. */
function providerWithJobs(query: string, jobs: JobSearchResult[]) {
  return new FakeProvider({
    search: { [`jobs:${query.trim().toLowerCase()}`]: jobs },
  });
}

describe("roleRepo", () => {
  let companies: CompanyRepo;
  let roles: RoleRepo;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    roles = createRoleRepo(db);
  });

  it("creates a role linked to a company with defaults", () => {
    const company = companies.create({ slug: "acme", name: "Acme" });
    const role = roles.create({
      companyId: company.id,
      title: "Founding Engineer",
      source: "google_jobs",
    });
    expect(role.id).toBeGreaterThan(0);
    expect(role.companyId).toBe(company.id);
    expect(role.status).toBe("new"); // default from schema
    expect(role.createdAt).toBeGreaterThan(0);
  });

  it("dedupes on external_id (partial-unique where not null)", () => {
    const company = companies.create({ slug: "acme", name: "Acme" });
    roles.create({ companyId: company.id, title: "A", externalId: "job-1" });
    expect(() =>
      roles.create({ companyId: company.id, title: "B", externalId: "job-1" }),
    ).toThrow();
    // null external_id rows are allowed to coexist
    expect(() => {
      roles.create({ companyId: company.id, title: "C" });
      roles.create({ companyId: company.id, title: "D" });
    }).not.toThrow();
  });

  it("finds a role by external_id; null/empty never matches", () => {
    const company = companies.create({ slug: "acme", name: "Acme" });
    const r = roles.create({ companyId: company.id, title: "A", externalId: "job-9" });
    expect(roles.findByExternalId("job-9")?.id).toBe(r.id);
    expect(roles.findByExternalId("missing")).toBeUndefined();
    expect(roles.findByExternalId(null)).toBeUndefined();
    expect(roles.findByExternalId(undefined)).toBeUndefined();
  });

  it("filters list by status and company", () => {
    const a = companies.create({ slug: "a", name: "A" });
    const b = companies.create({ slug: "b", name: "B" });
    roles.create({ companyId: a.id, title: "1", status: "new" });
    roles.create({ companyId: a.id, title: "2", status: "interesting" });
    roles.create({ companyId: b.id, title: "3", status: "new" });

    expect(roles.list()).toHaveLength(3);
    expect(roles.list({ status: "new" })).toHaveLength(2);
    expect(roles.list({ companyId: a.id })).toHaveLength(2);
    expect(roles.list({ companyId: a.id, status: "interesting" })).toHaveLength(1);
  });
});

describe("findJobs (job-first entry, FakeProvider, no network)", () => {
  let companies: CompanyRepo;
  let roles: RoleRepo;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    roles = createRoleRepo(db);
  });

  it("inserts roles and creates+links a company stub", async () => {
    const provider = providerWithJobs("founding engineer", [
      {
        title: "Founding Engineer",
        companyName: "Giga",
        location: "San Francisco, CA",
        link: "https://example.com/jobs/1",
        externalId: "giga-fe-1",
        postedDate: "2026-06-20",
        description: "Build the core agent platform.",
      },
    ]);

    const r = await findJobs({ provider, companies, roles }, "founding engineer");

    expect(r.inserted).toHaveLength(1);
    expect(r.companiesCreated).toHaveLength(1);

    const role = r.inserted[0];
    expect(role.title).toBe("Founding Engineer");
    expect(role.source).toBe("google_jobs");
    expect(role.externalId).toBe("giga-fe-1");

    // company was created as an unenriched `new` stub and linked
    const company = companies.get(role.companyId)!;
    expect(company.name).toBe("Giga");
    expect(company.status).toBe("new");
    expect(company.source).toBe("google_jobs");
    expect(company.domain).toBeNull(); // unenriched / unresolved
  });

  it("links roles to an existing company instead of duplicating it", async () => {
    const giga = companies.create({
      slug: "giga",
      name: "Giga",
      status: "interesting",
      domain: "giga.com",
    });

    const provider = providerWithJobs("ai role", [
      { title: "ML Engineer", companyName: "Giga", externalId: "giga-ml-1" },
    ]);

    const r = await findJobs({ provider, companies, roles }, "ai role");

    expect(r.companiesCreated).toHaveLength(0);
    expect(r.inserted[0].companyId).toBe(giga.id);
    // existing company status is untouched by find-jobs
    expect(companies.get(giga.id)!.status).toBe("interesting");
    expect(companies.list()).toHaveLength(1);
  });

  it("dedupes roles on external_id across runs", async () => {
    const jobs: JobSearchResult[] = [
      { title: "Founding Engineer", companyName: "Giga", externalId: "giga-fe-1" },
    ];
    const provider = providerWithJobs("dup query", jobs);

    const first = await findJobs({ provider, companies, roles }, "dup query");
    expect(first.inserted).toHaveLength(1);

    const second = await findJobs({ provider, companies, roles }, "dup query");
    expect(second.inserted).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
    expect(second.companiesCreated).toHaveLength(0);

    expect(roles.list()).toHaveLength(1);
    expect(companies.list()).toHaveLength(1);
  });

  it("infers remote work_type from the location string", async () => {
    const provider = providerWithJobs("remote role", [
      { title: "Remote Engineer", companyName: "Acme", location: "Remote (US)", externalId: "x1" },
    ]);
    const r = await findJobs({ provider, companies, roles }, "remote role");
    expect(r.inserted[0].workType).toBe("remote");
  });

  it("inserts only engineering, non-junior roles and reports the filtered count", async () => {
    const provider = providerWithJobs("mixed", [
      { title: "Founding Engineer", companyName: "Giga", externalId: "m-1" }, // keep
      { title: "Backend Developer", companyName: "Giga", externalId: "m-2" }, // keep
      { title: "Software Engineer Intern", companyName: "Giga", externalId: "m-3" }, // drop (junior)
      { title: "Enterprise Account Executive", companyName: "Giga", externalId: "m-4" }, // drop (non-eng)
      { title: "Designer", companyName: "Giga", externalId: "m-5" }, // drop (non-eng)
    ]);

    const r = await findJobs({ provider, companies, roles }, "mixed");

    expect(r.inserted.map((role) => role.title).sort()).toEqual([
      "Backend Developer",
      "Founding Engineer",
    ]);
    expect(r.filtered).toBe(3);
    expect(roles.list()).toHaveLength(2);
  });
});

describe("markRoleInteresting (funnel convergence)", () => {
  let companies: CompanyRepo;
  let roles: RoleRepo;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    roles = createRoleRepo(db);
  });

  it("promotes a `new` company to `interesting` when its role is marked interesting", async () => {
    const provider = providerWithJobs("fe", [
      { title: "Founding Engineer", companyName: "Giga", externalId: "g1" },
    ]);
    const { inserted } = await findJobs({ provider, companies, roles }, "fe");
    const role = inserted[0];

    expect(companies.get(role.companyId)!.status).toBe("new");

    const res = markRoleInteresting({ roles, companies }, role.id);

    expect(res.role.status).toBe("interesting");
    expect(res.company.status).toBe("interesting");
    expect(res.companyPromoted).toBe(true);
    // persisted through the data layer
    expect(roles.get(role.id)!.status).toBe("interesting");
    expect(companies.get(role.companyId)!.status).toBe("interesting");
  });

  it("does not regress a company already further along the funnel", () => {
    const company = companies.create({
      slug: "pursued",
      name: "Pursued",
      status: "pursuing",
    });
    const role = roles.create({ companyId: company.id, title: "X" });

    const res = markRoleInteresting({ roles, companies }, role.id);

    expect(res.role.status).toBe("interesting");
    expect(res.company.status).toBe("pursuing"); // unchanged
    expect(res.companyPromoted).toBe(false);
  });

  it("is idempotent when re-marking", () => {
    const company = companies.create({ slug: "c", name: "C", status: "new" });
    const role = roles.create({ companyId: company.id, title: "X" });

    markRoleInteresting({ roles, companies }, role.id);
    const second = markRoleInteresting({ roles, companies }, role.id);

    expect(second.company.status).toBe("interesting");
    expect(second.companyPromoted).toBe(false);
  });

  it("throws for an unknown role id", () => {
    expect(() => markRoleInteresting({ roles, companies }, 999)).toThrow();
  });
});

/**
 * Instrumented provider for the company-scoped harvest path: counts resolve
 * calls and serves jobs scoped to a companyId, so a test can prove a stored id
 * skips resolution while a missing id triggers exactly one resolve.
 */
class ScopedJobsProvider implements EnrichmentProvider {
  readonly name = "harvest";
  resolveCalls = 0;
  lastSearch: SearchQuery | undefined;
  constructor(
    private readonly resolution: CompanyResolution,
    private readonly jobs: JobSearchResult[],
  ) {}
  async resolveCompany(_q: CompanyQuery): Promise<CompanyResolution> {
    this.resolveCalls += 1;
    return this.resolution;
  }
  async getProfile(): Promise<never> {
    throw new Error("not used");
  }
  async getEmployees(): Promise<never> {
    throw new Error("not used");
  }
  async search(query: SearchQuery): Promise<SearchResult[]> {
    this.lastSearch = query;
    return this.jobs;
  }
}

describe("findJobsForCompany (company-scoped harvest — issue #36)", () => {
  let companies: CompanyRepo;
  let roles: RoleRepo;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    roles = createRoleRepo(db);
  });

  const job: JobSearchResult = {
    title: "Senior Engineer",
    companyName: "Acme",
    location: "San Francisco, CA",
    link: "https://www.linkedin.com/jobs/view/1",
    externalId: "li-1",
    postedDate: "2026-06-20",
  };

  it("searches by a stored linkedin_company_id WITHOUT resolving", async () => {
    const provider = new ScopedJobsProvider({ via: "harvest" }, [job]);
    const company = companies.create({
      slug: "acme",
      name: "Acme",
      linkedinCompanyId: "1815218",
      status: "interesting",
    });

    const r = await findJobsForCompany({ provider, companies, roles }, company.id);

    expect(provider.resolveCalls).toBe(0); // stored id → no resolve
    expect(provider.lastSearch?.companyId).toBe("1815218");
    expect(provider.lastSearch?.experienceLevel).toBe("mid-senior"); // default
    expect(r.resolvedCompanyId).toBe(false);
    expect(r.inserted).toHaveLength(1);
    expect(r.inserted[0].companyId).toBe(company.id); // exact company, no stub
  });

  it("resolves ONCE and persists the id when missing, then searches by it", async () => {
    const provider = new ScopedJobsProvider(
      { linkedinCompanyId: "424242", via: "harvest" },
      [job],
    );
    const company = companies.create({ slug: "acme", name: "Acme", status: "interesting" });
    expect(company.linkedinCompanyId).toBeNull();

    const r = await findJobsForCompany({ provider, companies, roles }, company.id);

    expect(provider.resolveCalls).toBe(1); // missing id → exactly one resolve
    expect(r.resolvedCompanyId).toBe(true);
    // The resolved id was persisted back on the company.
    expect(companies.get(company.id)?.linkedinCompanyId).toBe("424242");
    expect(provider.lastSearch?.companyId).toBe("424242");
    expect(r.inserted).toHaveLength(1);
  });

  it("dedupes on external_id across runs", async () => {
    const provider = new ScopedJobsProvider({ via: "harvest" }, [job]);
    const company = companies.create({
      slug: "acme",
      name: "Acme",
      linkedinCompanyId: "1",
      status: "interesting",
    });

    const first = await findJobsForCompany({ provider, companies, roles }, company.id);
    expect(first.inserted).toHaveLength(1);

    const second = await findJobsForCompany({ provider, companies, roles }, company.id);
    expect(second.inserted).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
  });
});
