import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";

describe("companyRepo", () => {
  let repo: CompanyRepo;

  beforeEach(() => {
    repo = createCompanyRepo(createTestDb());
  });

  it("creates a company and lists it", () => {
    const created = repo.create({ slug: "acme", name: "Acme" });
    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe("new"); // default from schema
    expect(created.createdAt).toBeGreaterThan(0);

    const all = repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Acme");
  });

  it("filters list by status", () => {
    repo.create({ slug: "a", name: "A", status: "new" });
    repo.create({ slug: "b", name: "B", status: "interesting" });
    repo.create({ slug: "c", name: "C", status: "interesting" });

    expect(repo.list({ status: "new" })).toHaveLength(1);
    expect(repo.list({ status: "interesting" })).toHaveLength(2);
    expect(repo.list({ status: "passed" })).toHaveLength(0);
    expect(repo.list()).toHaveLength(3);
  });

  it("gets by id and by slug", () => {
    const created = repo.create({ slug: "globex", name: "Globex" });
    expect(repo.get(created.id)?.name).toBe("Globex");
    expect(repo.getBySlug("globex")?.id).toBe(created.id);
    expect(repo.get(999)).toBeUndefined();
    expect(repo.getBySlug("nope")).toBeUndefined();
  });

  it("updates fields and bumps updatedAt", async () => {
    const created = repo.create({ slug: "init", name: "Init", status: "new" });
    // ensure the clock advances at least 1ms
    await new Promise((r) => setTimeout(r, 2));

    const updated = repo.update(created.id, {
      status: "enriched",
      scoreOverall: 0.87,
      scoreRationale: "Senior founders, strong lead investor",
    });

    expect(updated?.status).toBe("enriched");
    expect(updated?.scoreOverall).toBe(0.87);
    expect(updated?.scoreRationale).toContain("Senior founders");
    expect(updated!.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it("round-trips linkedin_company_id through update/get (issue #36)", () => {
    const created = repo.create({ slug: "acme", name: "Acme", status: "new" });
    expect(created.linkedinCompanyId).toBeNull();

    const updated = repo.update(created.id, { linkedinCompanyId: "1815218" });
    expect(updated?.linkedinCompanyId).toBe("1815218");
    // A fresh read sees the persisted value.
    expect(repo.get(created.id)?.linkedinCompanyId).toBe("1815218");
  });

  it("allows multiple unresolved (null domain/linkedin) companies", () => {
    // canonical-identity columns are null until the resolver runs (issue 02)
    expect(() => {
      repo.create({ slug: "x", name: "X" });
      repo.create({ slug: "y", name: "Y" });
    }).not.toThrow();
    expect(repo.list()).toHaveLength(2);
  });

  it("rejects duplicate canonical identity (same domain)", () => {
    repo.create({ slug: "first", name: "First", domain: "dup.com" });
    expect(() =>
      repo.create({ slug: "second", name: "Second", domain: "dup.com" }),
    ).toThrow();
  });

  it("rejects duplicate slug", () => {
    repo.create({ slug: "same", name: "One" });
    expect(() => repo.create({ slug: "same", name: "Two" })).toThrow();
  });
});
