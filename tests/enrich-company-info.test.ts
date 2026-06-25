import { describe, it, expect, beforeEach } from "vitest";
import {
  createCompanyRepo,
  type CompanyRepo,
} from "../src/db/repository";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { FakeProvider } from "../src/providers/fake";
import { CostMeter } from "../src/providers/cost";
import { enrichCompanyInfo, enrichCompaniesInfo } from "../src/enrich";
import { createTestDb } from "./helpers";

describe("enrichCompanyInfo (firmographics, no founders — issue #36)", () => {
  let companies: CompanyRepo;
  let people: PersonRepo;

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    people = createPersonRepo(db);
  });

  it("persists firmographics + linkedinCompanyId and advances new → enriched", async () => {
    const provider = new FakeProvider({
      companies: {
        acme: {
          domain: "acme.com",
          linkedinUrl: "https://www.linkedin.com/company/acme",
          linkedinCompanyId: "1815218",
          description: "Rockets.",
          sizeBand: "tiny",
          via: "fake",
        },
      },
    });
    const company = companies.create({ slug: "acme", name: "Acme", status: "new" });

    const meter = new CostMeter();
    const r = await enrichCompanyInfo({ companies, provider }, company.id, { meter });

    expect(r.company.domain).toBe("acme.com");
    expect(r.company.linkedinUrl).toBe("https://www.linkedin.com/company/acme");
    expect(r.company.linkedinCompanyId).toBe("1815218");
    expect(r.company.description).toBe("Rockets.");
    expect(r.company.sizeBand).toBe("tiny");
    expect(r.company.status).toBe("enriched");

    // It writes NO people rows.
    expect(people.listByCompany(company.id)).toHaveLength(0);
  });

  it("persists funding fields and still writes no people rows", async () => {
    const provider = new FakeProvider({
      companies: {
        acme: {
          domain: "acme.com",
          latestRound: "Series F",
          latestAmount: "$1.5B",
          lastFundingDate: "2024-03-01",
          leadInvestor: "Acme Ventures, Big Fund",
          fundingTotal: "$2.1B",
          via: "fake",
        },
      },
    });
    const company = companies.create({ slug: "acme", name: "Acme", status: "new" });

    const r = await enrichCompanyInfo({ companies, provider }, company.id);

    expect(r.company.latestRound).toBe("Series F");
    expect(r.company.latestAmount).toBe("$1.5B");
    expect(r.company.lastFundingDate).toBe("2024-03-01");
    expect(r.company.leadInvestor).toBe("Acme Ventures, Big Fund");
    expect(r.company.fundingTotal).toBe("$2.1B");
    expect(r.company.status).toBe("enriched");
    // Company-only pass: no people rows.
    expect(people.listByCompany(company.id)).toHaveLength(0);
  });

  it("never overwrites an existing value with a null/undefined return", async () => {
    // The resolution carries only a companyId; domain/description are absent.
    const provider = new FakeProvider({
      companies: {
        acme: { linkedinCompanyId: "999", via: "fake" },
      },
    });
    const company = companies.create({
      slug: "acme",
      name: "Acme",
      domain: "acme.com",
      description: "Existing description.",
      status: "new",
    });

    const r = await enrichCompanyInfo({ companies, provider }, company.id);

    expect(r.company.linkedinCompanyId).toBe("999");
    // The pre-existing fields survive (not clobbered by the absent values).
    expect(r.company.domain).toBe("acme.com");
    expect(r.company.description).toBe("Existing description.");
  });

  it("never regresses a further-along company and leaves `passed` untouched", async () => {
    const provider = new FakeProvider({
      companies: { a: { linkedinCompanyId: "1", via: "fake" }, b: { linkedinCompanyId: "1", via: "fake" } },
    });

    // A `pursuing` company is not regressed to `enriched`.
    const pursuing = companies.create({ slug: "a", name: "A", status: "pursuing" });
    const r1 = await enrichCompanyInfo({ companies, provider }, pursuing.id);
    expect(r1.company.status).toBe("pursuing");
    expect(r1.company.linkedinCompanyId).toBe("1");

    // A `passed` company stays passed (firmographics still persisted).
    const passed = companies.create({ slug: "b", name: "B", status: "passed" });
    const r2 = await enrichCompanyInfo({ companies, provider }, passed.id);
    expect(r2.company.status).toBe("passed");
    expect(r2.company.linkedinCompanyId).toBe("1");
  });

  it("enrichCompaniesInfo runs a batch with a per-company meter", async () => {
    const provider = new FakeProvider({
      companies: {
        acme: { domain: "acme.com", linkedinCompanyId: "1", via: "fake" },
        giga: { domain: "giga.com", linkedinCompanyId: "2", via: "fake" },
      },
    });
    const a = companies.create({ slug: "acme", name: "Acme", status: "new" });
    const b = companies.create({ slug: "giga", name: "Giga", status: "new" });

    const { results, totalUsd } = await enrichCompaniesInfo(
      [a.id, b.id],
      { companies, makeProvider: () => provider },
    );

    expect(results).toHaveLength(2);
    // Input order preserved.
    expect(results.map((r) => r.company.slug)).toEqual(["acme", "giga"]);
    expect(results.every((r) => r.company.status === "enriched")).toBe(true);
    // FakeProvider does not meter, so cost is zero — but the field is present.
    expect(totalUsd).toBe(0);
  });
});
