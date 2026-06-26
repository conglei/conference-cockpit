import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import {
  searchPeople,
  searchCompanies,
  searchRoles,
  getPerson,
  getRole,
  listVerticals,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type QueryRepos,
} from "../src/query";

function repos(db: DB): QueryRepos {
  return {
    people: createPersonRepo(db),
    companies: createCompanyRepo(db),
    roles: createRoleRepo(db),
    talks: createTalkRepo(db),
  };
}

describe("agent query primitives (ADR-0005)", () => {
  let db: DB;
  let r: QueryRepos;

  beforeEach(() => {
    db = createTestDb();
    r = repos(db);
    const acme = r.companies.create({
      slug: "acme",
      name: "Acme",
      status: "new",
      verticals: JSON.stringify(["AI in Healthcare", "Inference"]),
    });
    const other = r.companies.create({ slug: "other", name: "Other", status: "new", verticals: "[]" });
    r.people.create({ slug: "ada", name: "Ada Lovelace", companyId: acme.id, relationship: "network_contact", title: "CTO" });
    r.people.create({ slug: "bob", name: "Bob Smith", companyId: other.id, relationship: "network_contact", title: "Eng" });
    r.roles.create({ companyId: acme.id, title: "Founding Engineer", status: "new", workType: "remote", postedDate: "2026-06-01" });
    r.roles.create({ companyId: acme.id, title: "Designer", status: "new", workType: "onsite", postedDate: "2026-06-10" });
  });

  it("searchPeople filters by vertical (via the person's company) + projects compact", () => {
    const res = searchPeople(r, { vertical: "AI in Healthcare" });
    expect(res.people.map((p) => p.name)).toEqual(["Ada Lovelace"]);
    // compact projection — no bio/workHistory leaked into the list
    expect(res.people[0]).not.toHaveProperty("bio");
    expect(res.people[0]).toHaveProperty("speaking");
  });

  it("searchPeople text search spans name/title/company", () => {
    expect(searchPeople(r, { q: "ada" }).people).toHaveLength(1);
    expect(searchPeople(r, { q: "acme" }).people.map((p) => p.name)).toContain("Ada Lovelace");
  });

  it("caps the page size and reports a cursor", () => {
    const res = searchPeople(r, { limit: 1 });
    expect(res.people).toHaveLength(1);
    expect(res.total).toBe(2);
    expect(res.nextCursor).toBe(1);
    const next = searchPeople(r, { limit: 1, cursor: 1 });
    expect(next.people).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it("clamps an over-large limit to MAX_LIMIT and defaults sensibly", () => {
    expect(searchPeople(r, { limit: 9999 }).people.length).toBeLessThanOrEqual(MAX_LIMIT);
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it("searchCompanies supports hiring + vertical filters", () => {
    expect(searchCompanies(r, { hiring: true }).companies.map((c) => c.slug)).toEqual(["acme"]);
    expect(searchCompanies(r, { vertical: "Inference" }).companies).toHaveLength(1);
    expect(searchCompanies(r).companies.find((c) => c.slug === "acme")?.openRoles).toBe(2);
  });

  it("searchRoles is newest-first and filters by work type", () => {
    expect(searchRoles(r).roles.map((x) => x.title)).toEqual(["Designer", "Founding Engineer"]);
    expect(searchRoles(r, { workType: "remote" }).roles.map((x) => x.title)).toEqual(["Founding Engineer"]);
  });

  it("get* returns detail with a provenance source string", () => {
    const ada = getPerson(r, "ada");
    expect(ada?.name).toBe("Ada Lovelace");
    expect(ada?.source).toContain("as of");
    const roleId = searchRoles(r).roles[0].id;
    expect(getRole(r, roleId)?.source).toContain("as of");
  });

  it("listVerticals returns counts, busiest first", () => {
    const v = listVerticals(r).verticals;
    expect(v.find((x) => x.vertical === "AI in Healthcare")?.companies).toBe(1);
  });
});
