import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { FakeProvider } from "../src/providers";
import { CostMeter, COST_TABLE } from "../src/providers/cost";
import type {
  CompanyQuery,
  EmployeesQuery,
  EnrichmentProvider,
  ProfileQuery,
  SearchQuery,
  SearchResult,
} from "../src/providers/types";
import { enrichBatch } from "../src/enrich";
import { createTestDb } from "./helpers";

/**
 * A FakeProvider wrapper that records billable calls into an injected meter and
 * yields to the event loop on every call. The yield forces concurrent companies
 * to genuinely interleave their provider calls — which is exactly the condition
 * that, under a SHARED meter, inflated each company's delta. With per-company
 * meters (what enrichBatch does) interleaving is harmless and costs stay exact.
 */
class MeteringFake implements EnrichmentProvider {
  readonly name = "fake";
  constructor(
    private readonly inner: FakeProvider,
    private readonly meter: CostMeter,
  ) {}

  async getProfile(q: ProfileQuery) {
    await tick();
    this.meter.record("profile");
    return this.inner.getProfile(q);
  }

  async getEmployees(q: EmployeesQuery) {
    await tick();
    return this.inner.getEmployees(q);
  }

  async search(q: SearchQuery): Promise<SearchResult[]> {
    await tick();
    this.meter.record("webSearch");
    return this.inner.search(q);
  }

  resolveCompany(q: CompanyQuery) {
    return this.inner.resolveCompany(q);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("enrichBatch (offline, per-company cost isolation)", () => {
  let companies: CompanyRepo;
  let people: PersonRepo;
  let baseDir: string;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    people = createPersonRepo(db);
    baseDir = mkdtempSync(join(tmpdir(), "enrich-batch-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // Three companies whose rosters carry DIFFERENT founder counts, so each one
  // makes a different, predictable number of billable profile calls — that is
  // how we prove a company's cost reflects only ITS own calls, not neighbours'.
  const ROSTERS: Record<string, { founders: number }> = {
    "company/a": { founders: 1 },
    "company/b": { founders: 3 },
    "company/c": { founders: 2 },
  };

  function makeFixtures() {
    const employees: Record<string, Array<{ name: string; linkedinUrl: string; title: string }>> =
      {};
    for (const [path, { founders }] of Object.entries(ROSTERS)) {
      const url = `https://www.linkedin.com/${path}`;
      employees[url] = Array.from({ length: founders }, (_, i) => ({
        name: `Founder ${path}-${i}`,
        linkedinUrl: `https://www.linkedin.com/in/${path.replace("/", "-")}-${i}`,
        title: "Co-founder & CEO",
      }));
    }
    return new FakeProvider({ employees });
  }

  function seedCompanies() {
    const ids: number[] = [];
    for (const path of Object.keys(ROSTERS)) {
      const slug = path.replace("/", "-");
      const c = companies.create({
        slug,
        name: slug,
        linkedinUrl: `https://www.linkedin.com/${path}`,
        status: "new",
      });
      ids.push(c.id);
    }
    return ids;
  }

  // Each company makes: 1 web search + one profile fetch per rostered founder.
  function expectedCost(founders: number): number {
    return Math.round((COST_TABLE.webSearch + founders * COST_TABLE.profile) * 1e6) / 1e6;
  }

  it("attributes each company only its OWN provider calls (independent meters)", async () => {
    const fixtures = makeFixtures();
    const ids = seedCompanies();

    const { results } = await enrichBatch(
      ids,
      {
        companies,
        people,
        // One fresh meter + provider per company — the isolation under test.
        makeProvider: (meter) => ({ provider: new MeteringFake(fixtures, meter) }),
      },
      { baseDir, concurrency: 3 },
    );

    expect(results).toHaveLength(3);
    // Results preserve input order.
    const founderCounts = Object.values(ROSTERS).map((r) => r.founders);
    results.forEach((r, i) => {
      expect(r.costUsd).toBeCloseTo(expectedCost(founderCounts[i]), 9);
    });

    // Persisted cost matches too (no inflation from concurrent neighbours).
    for (const r of results) {
      const reloaded = companies.get(r.company.id);
      expect(reloaded?.enrichmentCost).toBeCloseTo(r.costUsd, 9);
    }
  });

  it("returns a grand total equal to the sum of per-company costs", async () => {
    const fixtures = makeFixtures();
    const ids = seedCompanies();

    const { results, totalUsd } = await enrichBatch(
      ids,
      {
        companies,
        people,
        makeProvider: (meter) => ({ provider: new MeteringFake(fixtures, meter) }),
      },
      { baseDir, concurrency: 3 },
    );

    const sum = results.reduce((acc, r) => acc + r.costUsd, 0);
    expect(totalUsd).toBeCloseTo(sum, 9);
    expect(totalUsd).toBeCloseTo(
      Object.values(ROSTERS).reduce((acc, r) => acc + expectedCost(r.founders), 0),
      9,
    );
  });

  it("tolerates a per-company error: skips it, keeps the batch going", async () => {
    const fixtures = makeFixtures();
    const ids = seedCompanies();
    const missingId = Math.max(...ids) + 999; // no such company → enrichCompany throws

    const { results } = await enrichBatch(
      [ids[0], missingId, ids[1]],
      {
        companies,
        people,
        makeProvider: (meter) => ({ provider: new MeteringFake(fixtures, meter) }),
      },
      { baseDir, concurrency: 3 },
    );

    // The bad id is skipped; the two good companies still enrich, in order.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.company.id)).toEqual([ids[0], ids[1]]);
  });
});
