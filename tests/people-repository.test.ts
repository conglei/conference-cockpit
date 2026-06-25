import { describe, it, expect, beforeEach } from "vitest";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";

describe("personRepo", () => {
  let people: PersonRepo;
  let companies: CompanyRepo;

  beforeEach(() => {
    const db = createTestDb();
    people = createPersonRepo(db);
    companies = createCompanyRepo(db);
  });

  it("creates a person with enum + boolean defaults", () => {
    const p = people.create({ slug: "jane", name: "Jane", relationship: "founder" });
    expect(p.id).toBeGreaterThan(0);
    expect(p.relationship).toBe("founder");
    expect(p.outreachStatus).toBe("none"); // default
    expect(p.canRefer).toBe(false); // boolean default
    expect(p.createdAt).toBeGreaterThan(0);
  });

  it("gets by id, slug, and linkedin url", () => {
    const p = people.create({
      slug: "sam",
      name: "Sam",
      relationship: "referrer",
      linkedinUrl: "https://www.linkedin.com/in/sam",
    });
    expect(people.get(p.id)?.name).toBe("Sam");
    expect(people.getBySlug("sam")?.id).toBe(p.id);
    expect(people.getByLinkedinUrl("https://www.linkedin.com/in/sam")?.id).toBe(p.id);
    expect(people.getBySlug("nope")).toBeUndefined();
  });

  it("links a person to a company and lists by company", () => {
    const c = companies.create({ slug: "acme", name: "Acme" });
    const p = people.create({ slug: "ceo", name: "CEO", relationship: "founder" });
    const linked = people.linkToCompany(p.id, c.id);
    expect(linked?.companyId).toBe(c.id);
    expect(people.list({ companyId: c.id })).toHaveLength(1);
    expect(people.list({ companyId: 999 })).toHaveLength(0);
  });

  it("allows multiple people with null linkedin url", () => {
    expect(() => {
      people.create({ slug: "a", name: "A", relationship: "founder" });
      people.create({ slug: "b", name: "B", relationship: "founder" });
    }).not.toThrow();
    expect(people.list()).toHaveLength(2);
  });

  it("rejects duplicate linkedin url and duplicate slug", () => {
    people.create({
      slug: "one",
      name: "One",
      relationship: "founder",
      linkedinUrl: "https://www.linkedin.com/in/dup",
    });
    expect(() =>
      people.create({
        slug: "two",
        name: "Two",
        relationship: "founder",
        linkedinUrl: "https://www.linkedin.com/in/dup",
      }),
    ).toThrow();
    expect(() =>
      people.create({ slug: "one", name: "Dup", relationship: "founder" }),
    ).toThrow();
  });
});
