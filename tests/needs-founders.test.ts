import { describe, it, expect } from "vitest";
import { needsFounders } from "../src/enrich/needs-founders";
import type { Company, CompanyStatus, Person, Relationship } from "../src/db/schema";

/** Minimal Company stub — only the fields the selector reads. */
function company(id: number, name: string, status: CompanyStatus): Company {
  return { id, name, slug: name.toLowerCase(), status } as unknown as Company;
}

/** Minimal Person stub — only the fields the selector reads. */
function person(companyId: number, relationship: Relationship): Person {
  return { companyId, relationship } as unknown as Person;
}

describe("needsFounders", () => {
  it("returns enriched companies that have no founder rows", () => {
    const acme = company(1, "Acme", "enriched"); // enriched, zero people
    const companies = [acme];
    const peopleByCompany = new Map<number, Person[]>();

    expect(needsFounders(companies, peopleByCompany)).toEqual([acme]);
  });

  it("excludes enriched companies that already have a founder", () => {
    const withFounder = company(2, "HasFounder", "enriched");
    const peopleByCompany = new Map<number, Person[]>([
      [2, [person(2, "founder")]],
    ]);

    expect(needsFounders([withFounder], peopleByCompany)).toEqual([]);
  });

  it("includes an enriched company that has people but none are founders", () => {
    const onlyReferrers = company(3, "OnlyReferrers", "enriched");
    const peopleByCompany = new Map<number, Person[]>([
      [3, [person(3, "referrer"), person(3, "network_contact")]],
    ]);

    expect(needsFounders([onlyReferrers], peopleByCompany)).toEqual([onlyReferrers]);
  });

  it("excludes non-enriched companies even when they have no founders", () => {
    const fresh = company(4, "Fresh", "new");
    const interesting = company(5, "Interesting", "interesting");
    const peopleByCompany = new Map<number, Person[]>();

    expect(needsFounders([fresh, interesting], peopleByCompany)).toEqual([]);
  });

  it("filters a mixed funnel to only the enriched, founder-less companies", () => {
    const needsIt = company(10, "NeedsIt", "enriched"); // enriched, no people
    const recovered = company(11, "Recovered", "enriched"); // enriched, has founder
    const newCo = company(12, "NewCo", "new"); // not enriched
    const passedCo = company(13, "PassedCo", "passed"); // not enriched

    const peopleByCompany = new Map<number, Person[]>([
      [11, [person(11, "founder")]],
    ]);

    const result = needsFounders(
      [needsIt, recovered, newCo, passedCo],
      peopleByCompany,
    );

    expect(result).toEqual([needsIt]);
  });
});
