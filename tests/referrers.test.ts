import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { FakeProvider } from "../src/providers";
import {
  LinkedinCsvSource,
  stripLinkedinPreamble,
  ingestConnections,
  crossReferenceCompany,
  whoNext,
  connectionStrength,
} from "../src/referrers";

// A realistic LinkedIn connections export: "Notes:" preamble, then the header.
const LINKEDIN_CSV = `Notes:
"When exporting your connection data, you may notice that…"

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Sam,Engineer,https://www.linkedin.com/in/sam-engineer,,Giga,Founding Engineer,01 Jun 2026
Jane,Founder,https://www.linkedin.com/in/jane-founder,,Giga,Co-founder & CEO,15 May 2026
Pat,Outsider,https://www.linkedin.com/in/pat-outsider,,Other Co,PM,02 Feb 2026
Nora,Nourl,,,,,03 Mar 2026
`;

describe("LinkedinCsvSource (connection-source adapter)", () => {
  it("strips the LinkedIn 'Notes:' preamble before the header", () => {
    const stripped = stripLinkedinPreamble(LINKEDIN_CSV);
    expect(stripped.startsWith("First Name,Last Name,URL")).toBe(true);
    // A clean CSV (no preamble) passes through untouched.
    const clean = "First Name,Last Name,URL\nA,B,x";
    expect(stripLinkedinPreamble(clean)).toBe(clean);
  });

  it("reads normalized 1st-degree connections", () => {
    const conns = new LinkedinCsvSource(LINKEDIN_CSV).read();
    expect(conns).toHaveLength(4);
    expect(conns[0]).toMatchObject({
      name: "Sam Engineer",
      linkedinUrl: "https://www.linkedin.com/in/sam-engineer",
      title: "Founding Engineer",
      company: "Giga",
    });
    // A row with no URL still yields a usable contact.
    expect(conns[3]).toMatchObject({ name: "Nora Nourl" });
    expect(conns[3].linkedinUrl).toBeUndefined();
  });
});

describe("ingestConnections", () => {
  let people: PersonRepo;
  beforeEach(async () => {
    people = createPersonRepo(await createTestDb());
  });

  it("ingests connections as 1st-degree network contacts", async () => {
    const r = await ingestConnections(people, new LinkedinCsvSource(LINKEDIN_CSV));
    expect(r.inserted).toBe(4);
    const sam = await people.getByLinkedinUrl("https://www.linkedin.com/in/sam-engineer");
    expect(sam?.relationship).toBe("network_contact");
    expect(sam?.connectionDegree).toBe(1);
    expect(sam?.canRefer).toBe(false);
    expect(await people.listConnections()).toHaveLength(4);
  });

  it("is idempotent — re-ingesting the same export adds no duplicates", async () => {
    await ingestConnections(people, new LinkedinCsvSource(LINKEDIN_CSV));
    const second = await ingestConnections(people, new LinkedinCsvSource(LINKEDIN_CSV));
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(4);
    expect(await people.list()).toHaveLength(4);
  });
});

describe("crossReferenceCompany", () => {
  let people: PersonRepo;
  let companies: CompanyRepo;
  beforeEach(async () => {
    const db = await createTestDb();
    people = createPersonRepo(db);
    companies = createCompanyRepo(db);
  });

  it("flags connections on the roster as referrers (sets degree + can_refer)", async () => {
    await ingestConnections(people, new LinkedinCsvSource(LINKEDIN_CSV));
    // Giga's roster (default FakeProvider fixture) includes Jane + Sam, who are
    // both in the user's connections; Pat is a connection but NOT on the roster.
    const giga = await companies.create({
      slug: "giga",
      name: "Giga",
      linkedinUrl: "https://www.linkedin.com/company/gigaml",
    });

    const r = await crossReferenceCompany(
      companies,
      people,
      new FakeProvider(),
      giga,
    );

    expect(r.rosterSize).toBe(2);
    const names = r.referrers.map((p) => p.name).sort();
    expect(names).toEqual(["Jane Founder", "Sam Engineer"]);
    for (const p of r.referrers) {
      expect(p.canRefer).toBe(true);
      expect(p.companyId).toBe(giga.id);
      expect(p.connectionDegree).toBe(1);
    }
    // Pat is a connection but not on the roster → not flagged.
    const pat = await people.getByLinkedinUrl("https://www.linkedin.com/in/pat-outsider");
    expect(pat?.canRefer).toBe(false);
    expect(await people.listReferrers()).toHaveLength(2);
  });

  it("returns no referrers when the company has no LinkedIn URL", async () => {
    await ingestConnections(people, new LinkedinCsvSource(LINKEDIN_CSV));
    const c = await companies.create({ slug: "unresolved", name: "Unresolved" });
    const r = await crossReferenceCompany(companies, people, new FakeProvider(), c);
    expect(r.rosterSize).toBe(0);
    expect(r.referrers).toHaveLength(0);
  });
});

describe("whoNext ordering (fit × connection-strength)", () => {
  let people: PersonRepo;
  let companies: CompanyRepo;
  beforeEach(async () => {
    const db = await createTestDb();
    people = createPersonRepo(db);
    companies = createCompanyRepo(db);
  });

  it("connectionStrength weakens with degree", () => {
    expect(connectionStrength(1)).toBe(1);
    expect(connectionStrength(2)).toBe(0.5);
    expect(connectionStrength(null)).toBe(1);
  });

  it("ranks by company-fit × connection-strength", async () => {
    const hot = await companies.create({ slug: "hot", name: "Hot Co", scoreOverall: 0.9 });
    const cool = await companies.create({ slug: "cool", name: "Cool Co", scoreOverall: 0.4 });

    // A: 1st-degree at the high-fit company → 0.9 × 1.0 = 0.90
    const a = await people.create({
      slug: "a",
      name: "A Contact",
      relationship: "network_contact",
      connectionDegree: 1,
      canRefer: true,
      companyId: hot.id,
    });
    // B: 2nd-degree at the high-fit company → 0.9 × 0.5 = 0.45
    const b = await people.create({
      slug: "b",
      name: "B Contact",
      relationship: "network_contact",
      connectionDegree: 2,
      canRefer: true,
      companyId: hot.id,
    });
    // C: 1st-degree at the lower-fit company → 0.4 × 1.0 = 0.40
    const c = await people.create({
      slug: "c",
      name: "C Contact",
      relationship: "network_contact",
      connectionDegree: 1,
      canRefer: true,
      companyId: cool.id,
    });
    // Not a referrer → excluded entirely.
    await people.create({
      slug: "d",
      name: "D Contact",
      relationship: "network_contact",
      connectionDegree: 1,
      canRefer: false,
      companyId: hot.id,
    });

    const ranked = await whoNext(people, companies);
    expect(ranked.map((e) => e.person.id)).toEqual([a.id, b.id, c.id]);
    expect(ranked[0].priority).toBeCloseTo(0.9);
    expect(ranked[1].priority).toBeCloseTo(0.45);
    expect(ranked[2].priority).toBeCloseTo(0.4);
  });

  it("gives an unscored company a neutral fit so warm paths aren't buried", async () => {
    const c = await companies.create({ slug: "unscored", name: "Unscored" });
    const p = await people.create({
      slug: "p",
      name: "P",
      relationship: "network_contact",
      connectionDegree: 1,
      canRefer: true,
      companyId: c.id,
    });
    const ranked = await whoNext(people, companies);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].person.id).toBe(p.id);
    expect(ranked[0].companyFit).toBe(0.5);
  });
});
