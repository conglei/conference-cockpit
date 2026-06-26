import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { buildScoringContext } from "../src/scoring";

describe("buildScoringContext (per-company judgment bundle)", () => {
  let db: DB;

  beforeEach(async () => {
    db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const roles = createRoleRepo(db);

    const acme = await companies.create({
      slug: "acme",
      name: "Acme",
      status: "new",
      stage: "Seed",
      leadInvestor: "Sequoia",
      verticals: JSON.stringify(["Agentic Engineering"]),
    });
    const other = await companies.create({ slug: "other", name: "Other", status: "new", verticals: "[]" });

    // A founder who clears the bar (ex-OpenAI, PhD).
    await people.create({
      slug: "ada",
      name: "Ada",
      companyId: acme.id,
      relationship: "network_contact",
      title: "Co-founder & CEO",
      currentCompany: "Acme",
      workHistory: JSON.stringify([{ company: "OpenAI", end: "2023" }]),
      education: JSON.stringify([{ school: "MIT", degree: "PhD" }]),
    });
    // A non-founder employee at the same company (should be excluded from founders).
    await people.create({ slug: "joe", name: "Joe", companyId: acme.id, relationship: "network_contact", title: "Engineer" });
    await roles.create({ companyId: acme.id, title: "Founding Engineer", status: "new" });
  });

  it("bundles firmographics + funding + founders-with-pedigree + role titles", async () => {
    const ctx = await buildScoringContext({
      companies: createCompanyRepo(db),
      people: createPersonRepo(db),
      roles: createRoleRepo(db),
    });
    const acme = ctx.find((c) => c.slug === "acme")!;
    expect(acme.stage).toBe("Seed");
    expect(acme.funding.lead).toBe("Sequoia");
    expect(acme.verticals).toEqual(["Agentic Engineering"]);
    expect(acme.openRoleTitles).toEqual(["Founding Engineer"]);
    // only the founder is listed, with RAW facts (no pre-judged "founder bar")
    expect(acme.founders.map((f) => f.name)).toEqual(["Ada"]);
    expect(acme.founders[0].pastEmployers).toContain("OpenAI");
    expect(acme.founders[0].education).toMatch(/PhD/);
  });

  it("supports vertical + hiring filters", async () => {
    const repos = { companies: createCompanyRepo(db), people: createPersonRepo(db), roles: createRoleRepo(db) };
    expect((await buildScoringContext(repos, { vertical: "Agentic Engineering" })).map((c) => c.slug)).toEqual(["acme"]);
    expect((await buildScoringContext(repos, { hiringOnly: true })).map((c) => c.slug)).toEqual(["acme"]);
  });
});
