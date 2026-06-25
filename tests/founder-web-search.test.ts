import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { FakeProvider } from "../src/providers";
import type {
  Company,
  CompanyStatus,
} from "../src/db/schema";
import { enrichCompany, webSearchFounders } from "../src/enrich";

/** Minimal Company stub for the unit tests (only fields the rung reads). */
function fakeCompany(name: string): Company {
  return { name } as unknown as Company;
}

describe("webSearchFounders (unit, injected search provider)", () => {
  it("extracts names + titles when a founder/exec cue sits next to a full name", async () => {
    const provider = new FakeProvider({
      search: {
        "web:acme founders": [
          {
            title: "Acme — About the team",
            link: "https://acme.example/about",
            snippet:
              "Acme was founded by co-founder Jane Doe and CTO Richard Roe in 2021.",
          },
        ],
        "web:acme ceo co-founder": [
          {
            title: "Jane Doe, CEO of Acme, on building agents | TechCrunch",
            link: "https://news.example/acme",
            snippet: "Acme CEO Jane Doe talks about the road ahead.",
          },
        ],
      },
    });

    const notes: string[] = [];
    const founders = await webSearchFounders(provider, fakeCompany("Acme"), notes);

    const names = founders.map((f) => f.name).sort();
    expect(names).toEqual(["Jane Doe", "Richard Roe"]);

    const jane = founders.find((f) => f.name === "Jane Doe");
    expect(jane?.title).toBe("Co-founder");
    const richard = founders.find((f) => f.name === "Richard Roe");
    expect(richard?.title).toBe("CTO");

    expect(notes.join(" ")).toContain("web-search founder recovery");
    expect(notes.join(" ")).toContain("Jane Doe");
  });

  it("is conservative: ignores results with no clear name+cue pairing", async () => {
    const provider = new FakeProvider({
      search: {
        "web:nocue founders": [
          {
            // Capitalized phrases, but no founder/exec cue adjacent → ignored.
            title: "New York Times covers Silicon Valley startups",
            link: "https://news.example/x",
            snippet: "The company raised a round. Great Product launched today.",
          },
        ],
        "web:nocue ceo co-founder": [
          {
            title: "About Nocue",
            link: "https://nocue.example",
            snippet: "We build things. Our mission is bold.",
          },
        ],
      },
    });

    const notes: string[] = [];
    const founders = await webSearchFounders(provider, fakeCompany("Nocue"), notes);
    expect(founders).toEqual([]);
    expect(notes.join(" ")).toContain("no confident founder names");
  });

  it("dedupes the same name across both queries and caps at ~4", async () => {
    const provider = new FakeProvider({
      search: {
        "web:big founders": [
          {
            title: "Big team",
            link: "https://big.example",
            snippet:
              "Founder Alice Alpha, co-founder Bob Beta, CTO Carol Gamma, CEO Dave Delta, founder Eve Epsilon.",
          },
        ],
        "web:big ceo co-founder": [
          {
            title: "Alice Alpha leads Big",
            link: "https://news.example/big",
            snippet: "CEO Alice Alpha on growth.",
          },
        ],
      },
    });

    const notes: string[] = [];
    const founders = await webSearchFounders(provider, fakeCompany("Big"), notes);

    // Capped at 4, and Alice Alpha (in both queries) appears once.
    expect(founders.length).toBeLessThanOrEqual(4);
    const aliceCount = founders.filter((f) => f.name === "Alice Alpha").length;
    expect(aliceCount).toBe(1);
  });

  it("drops the company name parsed as a person and single-token names", async () => {
    const provider = new FakeProvider({
      search: {
        "web:arcade founders": [
          {
            title: "Arcade team",
            link: "https://arcade.example",
            snippet:
              "Arcade Software founder, co-founder Mariam Naficy, and founder Bob built it.",
          },
        ],
        "web:arcade ceo co-founder": [],
      },
    });

    const notes: string[] = [];
    const founders = await webSearchFounders(provider, fakeCompany("Arcade"), notes);

    // Only the real person survives: "Arcade Software" is the company name as a
    // person, and "Bob" is a single token that never forms a full name.
    expect(founders.map((f) => f.name)).toEqual(["Mariam Naficy"]);
    expect(notes.join(" ")).toContain("dropped");
    expect(notes.join(" ")).toContain("as noise");
  });

  it("drops a company name plus a generic corp suffix (Giga Co)", async () => {
    const provider = new FakeProvider({
      search: {
        "web:giga founders": [
          {
            title: "Giga",
            link: "https://giga.example",
            snippet:
              "Giga Co founder note. Co-founder Esther Crawford leads product.",
          },
        ],
        "web:giga ceo co-founder": [],
      },
    });

    const notes: string[] = [];
    const founders = await webSearchFounders(provider, fakeCompany("Giga"), notes);

    expect(founders.map((f) => f.name)).toEqual(["Esther Crawford"]);
    expect(notes.join(" ")).toContain("dropped");
  });

  it("on a provider error pushes a note and returns []", async () => {
    const broken: import("../src/providers/types").EnrichmentProvider = {
      name: "broken",
      resolveCompany: async () => ({ via: "broken" }),
      getProfile: async () => {
        throw new Error("unused");
      },
      getEmployees: async () => [],
      search: async () => {
        throw new Error("network down");
      },
    };

    const notes: string[] = [];
    const founders = await webSearchFounders(broken, fakeCompany("Boom"), notes);
    expect(founders).toEqual([]);
    expect(notes.join(" ")).toContain("web-search founder recovery failed");
  });
});

describe("enrichCompany web-search fallback (only when roster is empty)", () => {
  let companies: CompanyRepo;
  let people: PersonRepo;
  let baseDir: string;

  beforeEach(async () => {
    const { createTestDb } = await import("./helpers");
    const db = createTestDb();
    companies = createCompanyRepo(db);
    people = createPersonRepo(db);
    baseDir = mkdtempSync(join(tmpdir(), "founder-ws-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function makeCompany(name: string, slug: string, status: CompanyStatus = "new") {
    return companies.create({
      slug,
      name,
      linkedinUrl: `https://www.linkedin.com/company/${slug}`,
      status,
    });
  }

  it("invokes the fallback when the roster is empty, persisting recovered founders", async () => {
    // Roster provider returns NO employees for any company URL.
    const roster = new FakeProvider({ employees: {} });
    // Separate search provider carries the founder web results.
    const search = new FakeProvider({
      search: {
        "web:emptyco founders": [
          {
            title: "EmptyCo team",
            link: "https://emptyco.example",
            snippet: "EmptyCo was founded by co-founder Nadia Web and CEO Omar Search.",
          },
        ],
        "web:emptyco ceo co-founder": [],
      },
    });

    const c = makeCompany("EmptyCo", "emptyco");
    const r = await enrichCompany(
      { companies, people, provider: roster },
      c.id,
      { baseDir, searchProvider: search },
    );

    const names = r.people.map((p) => p.person.name).sort();
    expect(names).toEqual(["Nadia Web", "Omar Search"]);

    const rows = people.list({ companyId: c.id });
    const nadia = rows.find((p) => p.name === "Nadia Web");
    expect(nadia).toBeDefined();
    expect(nadia!.relationship).toBe("founder");
    expect(nadia!.companyId).toBe(c.id);
    expect(nadia!.linkedinUrl).toBeNull();
    expect(nadia!.title).toBe("Co-founder");

    expect(r.notes.join(" ")).toContain("web-search founder fallback");
  });

  it("does NOT invoke the fallback when the roster already has founders", async () => {
    // Giga has rostered founders in the default fixtures (Jane Founder).
    const roster = new FakeProvider();
    // A search provider that, IF wrongly consulted, would inject a founder.
    const search = new FakeProvider({
      search: {
        "web:giga founders": [
          {
            title: "Giga",
            link: "https://giga.example",
            snippet: "Giga founded by CEO Should Notappear.",
          },
        ],
      },
    });

    const c = companies.create({
      slug: "giga",
      name: "Giga",
      linkedinUrl: "https://www.linkedin.com/company/gigaml",
      status: "new",
    });
    const r = await enrichCompany(
      { companies, people, provider: roster },
      c.id,
      { baseDir, searchProvider: search },
    );

    const names = r.people.map((p) => p.person.name);
    expect(names).toContain("Jane Founder");
    expect(names).not.toContain("Should Notappear");
    expect(r.notes.join(" ")).not.toContain("web-search founder fallback");
  });
});
