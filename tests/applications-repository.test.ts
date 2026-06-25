import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import {
  createApplicationRepo,
  type ApplicationRepo,
} from "../src/db/applications-repository";
import { createCompanyRepo } from "../src/db/repository";
import {
  people,
  roles,
  type CompanyStatus,
  type Relationship,
  type OutreachStatus,
} from "../src/db/schema";
import type { DB } from "../src/db/client";

function makeCompany(db: DB, slug: string, status: CompanyStatus) {
  return createCompanyRepo(db).create({ slug, name: slug, status });
}

function makeRole(db: DB, companyId: number, title = "Founding Engineer") {
  const ts = Date.now();
  return db
    .insert(roles)
    .values({ companyId, title, status: "interesting", createdAt: ts, updatedAt: ts })
    .returning()
    .get();
}

function makePerson(
  db: DB,
  slug: string,
  companyId: number,
  relationship: Relationship,
  outreachStatus: OutreachStatus = "none",
) {
  const ts = Date.now();
  return db
    .insert(people)
    .values({
      slug,
      name: slug,
      companyId,
      relationship,
      outreachStatus,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
}

describe("applicationRepo CRUD", () => {
  let db: DB;
  let repo: ApplicationRepo;

  beforeEach(() => {
    db = createTestDb();
    repo = createApplicationRepo(db);
  });

  it("creates, gets, lists and filters by status", () => {
    const c = makeCompany(db, "acme", "pursuing");
    const r = makeRole(db, c.id);
    const a = repo.create({ roleId: r.id, companyId: c.id });

    expect(repo.get(a.id)?.id).toBe(a.id);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list({ status: "interested" })).toHaveLength(1);
    expect(repo.list({ status: "offer" })).toHaveLength(0);
  });

  it("joins role + company + contact in listWithContext", () => {
    const c = makeCompany(db, "globex", "pursuing");
    const r = makeRole(db, c.id, "Member of Technical Staff");
    const p = makePerson(db, "ada", c.id, "referrer");
    repo.create({ roleId: r.id, companyId: c.id, contactPersonId: p.id });

    const [row] = repo.listWithContext();
    expect(row.company.name).toBe("globex");
    expect(row.role.title).toBe("Member of Technical Staff");
    expect(row.contact?.name).toBe("ada");
  });

  it("listWithContext leaves contact null when none is linked", () => {
    const c = makeCompany(db, "noref", "pursuing");
    const r = makeRole(db, c.id);
    repo.create({ roleId: r.id, companyId: c.id });
    const [row] = repo.listWithContext();
    expect(row.contact).toBeNull();
  });
});

describe("cross-entity: interesting + not-yet-contacted", () => {
  let db: DB;
  let repo: ApplicationRepo;

  beforeEach(() => {
    db = createTestDb();
    repo = createApplicationRepo(db);
  });

  it("returns interesting companies with uncontacted founders/referrers and no application", () => {
    // ✓ qualifies: interesting, has an uncontacted founder, no application
    const good = makeCompany(db, "good", "interesting");
    makePerson(db, "founder-good", good.id, "founder");

    // ✗ wrong funnel stage (new) — even with a founder
    const tooEarly = makeCompany(db, "too-early", "new");
    makePerson(db, "founder-early", tooEarly.id, "founder");

    // ✗ already in the pipeline (has an application)
    const engaged = makeCompany(db, "engaged", "pursuing");
    const engagedRole = makeRole(db, engaged.id);
    makePerson(db, "founder-engaged", engaged.id, "founder");
    repo.create({ roleId: engagedRole.id, companyId: engaged.id });

    // ✗ interesting but only a generic network contact (not founder/referrer)
    const noFounder = makeCompany(db, "no-founder", "watching");
    makePerson(db, "contact-nf", noFounder.id, "network_contact");

    // ✗ interesting + founder, but the founder has already been contacted
    const contacted = makeCompany(db, "contacted", "pursuing");
    makePerson(db, "founder-contacted", contacted.id, "founder", "contacted");

    const leads = repo.interestingNotContacted();
    const names = leads.map((l) => l.company.name).sort();
    expect(names).toEqual(["good"]);
    expect(leads[0].contacts.map((p) => p.name)).toEqual(["founder-good"]);
  });

  it("returns referrers as well as founders", () => {
    const c = makeCompany(db, "refco", "watching");
    makePerson(db, "the-referrer", c.id, "referrer");
    const leads = repo.interestingNotContacted();
    expect(leads.map((l) => l.company.name)).toEqual(["refco"]);
  });

  it("returns nothing when no companies are in scope", () => {
    makeCompany(db, "passed", "passed");
    expect(repo.interestingNotContacted()).toEqual([]);
  });

  it("honors a custom status set", () => {
    const c = makeCompany(db, "enriched-co", "enriched");
    makePerson(db, "f", c.id, "founder");
    // default set excludes `enriched`
    expect(repo.interestingNotContacted()).toEqual([]);
    // but a caller can opt it in
    const leads = repo.interestingNotContacted({ statuses: ["enriched"] });
    expect(leads.map((l) => l.company.name)).toEqual(["enriched-co"]);
  });
});
