import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import { FakeProvider } from "../src/providers";
import type {
  CompanyQuery,
  CompanyResolution,
  Employee,
  EmployeesQuery,
  EnrichmentProvider,
  Profile,
  ProfileQuery,
  SearchQuery,
  SearchResult,
} from "../src/providers/types";
import { enrichCompany } from "../src/enrich";
import { createTestDb } from "./helpers";

describe("enrichCompany (offline, FakeProvider)", () => {
  let companies: CompanyRepo;
  let people: PersonRepo;
  let baseDir: string;
  const provider = new FakeProvider();

  beforeEach(() => {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    people = createPersonRepo(db);
    baseDir = mkdtempSync(join(tmpdir(), "enrich-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // Giga is in the FakeProvider default fixtures: a resolved LinkedIn company
  // URL with two rostered employees (Jane Founder, Sam Engineer).
  function makeGiga() {
    return companies.create({
      slug: "giga",
      name: "Giga",
      linkedinUrl: "https://www.linkedin.com/company/gigaml",
      status: "new",
    });
  }

  it("writes the company deep-dive and founder deep-dives to the base dir", async () => {
    const c = makeGiga();
    const r = await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    const companyMd = join(baseDir, "companies", "giga.md");
    expect(existsSync(companyMd)).toBe(true);
    expect(r.deepDivePath).toBe(companyMd);
    expect(readFileSync(companyMd, "utf8")).toContain("# Giga");

    // Jane Founder is a "Co-founder & CEO" → a founder deep-dive is written.
    expect(r.people.length).toBeGreaterThanOrEqual(1);
    for (const p of r.people) {
      expect(existsSync(p.notesPath)).toBe(true);
      expect(readFileSync(p.notesPath, "utf8")).toContain(`# ${p.person.name}`);
    }
  });

  it("creates founder people rows linked to the company with notes_path set", async () => {
    const c = makeGiga();
    await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    const rows = people.list({ companyId: c.id });
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const jane = rows.find((p) => p.name === "Jane Founder");
    expect(jane).toBeDefined();
    expect(jane!.relationship).toBe("founder");
    expect(jane!.companyId).toBe(c.id);
    expect(jane!.title).toContain("Co-founder");
    expect(jane!.notesPath).toBe(join(baseDir, "people", `${jane!.slug}.md`));

    // The non-founder employee (Sam Engineer, "Founding Engineer") is excluded.
    expect(rows.find((p) => p.name === "Sam Engineer")).toBeUndefined();
  });

  it("advances the company new → enriched and sets deep_dive_path", async () => {
    const c = makeGiga();
    expect(c.status).toBe("new");
    const r = await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    expect(r.company.status).toBe("enriched");
    expect(r.company.deepDivePath).toBe(join(baseDir, "companies", "giga.md"));

    // persisted, not just returned
    const reloaded = companies.getBySlug("giga");
    expect(reloaded?.status).toBe("enriched");
    expect(reloaded?.deepDivePath).toBe(r.company.deepDivePath);
  });

  it("includes web/funding context from search in the company deep-dive", async () => {
    // Seed a web-search fixture keyed by the query the flow issues.
    const p = new FakeProvider({
      search: {
        "web:giga funding": [
          {
            title: "Giga raises Series A",
            link: "https://news.example/giga-series-a",
            snippet: "Giga raised $30M led by a16z.",
          },
        ],
      },
    });
    const c = makeGiga();
    await enrichCompany({ companies, people, provider: p }, c.id, { baseDir });

    const md = readFileSync(join(baseDir, "companies", "giga.md"), "utf8");
    expect(md).toContain("Giga raises Series A");
  });

  it("is idempotent: re-enriching does not duplicate founder rows", async () => {
    const c = makeGiga();
    await enrichCompany({ companies, people, provider }, c.id, { baseDir });
    const first = people.list({ companyId: c.id }).length;
    await enrichCompany({ companies, people, provider }, c.id, { baseDir });
    const second = people.list({ companyId: c.id }).length;
    expect(second).toBe(first);
  });

  // Apollo-shaped flow: the roster masks the founder (no LinkedIn) but carries a
  // providerId; getProfile reveals the full name + LinkedIn. resolveFounder must
  // pass providerId through and persist the revealed identity.
  it("passes providerId to getProfile and persists the revealed name + LinkedIn", async () => {
    let seenProfileQuery: ProfileQuery | undefined;
    const provider: EnrichmentProvider = {
      name: "apollo-like",
      async resolveCompany(_q: CompanyQuery): Promise<CompanyResolution> {
        return { via: "apollo-like" };
      },
      async getEmployees(_q: EmployeesQuery): Promise<Employee[]> {
        // Masked roster: obfuscated name, NO linkedinUrl, but a providerId.
        return [{ name: "Charles Pa***r", title: "Co-Founder & CEO", providerId: "abc123" }];
      },
      async getProfile(q: ProfileQuery): Promise<Profile> {
        seenProfileQuery = q;
        return {
          name: "Charles Packer",
          linkedinUrl: "http://www.linkedin.com/in/charles-packer",
          title: "Co-Founder & CEO",
          raw: { name: "Charles Packer" },
        };
      },
      async search(_q: SearchQuery): Promise<SearchResult[]> {
        return [];
      },
    };

    const c = companies.create({
      slug: "letta",
      name: "Letta",
      domain: "letta.com",
      status: "new",
    });
    const r = await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    expect(seenProfileQuery?.providerId).toBe("abc123");
    expect(r.people).toHaveLength(1);
    const charles = r.people[0].person;
    expect(charles.name).toBe("Charles Packer");
    expect(charles.linkedinUrl).toBe("http://www.linkedin.com/in/charles-packer");
  });

  // Issue #32: the roster path persists whatever getEmployees returns; an
  // org/role string mis-rostered as a person (e.g. "Information Security") must
  // be dropped at the chokepoint, leaving only the real founder + a drop note.
  it("drops a non-person roster entry and keeps the real founder", async () => {
    const provider: EnrichmentProvider = {
      name: "roster-noise",
      async resolveCompany(_q: CompanyQuery): Promise<CompanyResolution> {
        return { via: "roster-noise" };
      },
      async getEmployees(_q: EmployeesQuery): Promise<Employee[]> {
        return [
          { name: "Charles Packer", title: "Co-Founder & CEO", providerId: "real" },
          { name: "Information Security", title: "Founder", providerId: "noise" },
        ];
      },
      async getProfile(q: ProfileQuery): Promise<Profile> {
        // Echo each candidate back unchanged (no masking) so the roster name is
        // what reaches the guard.
        if (q.providerId === "noise") {
          return {
            name: "Information Security",
            linkedinUrl: "",
            title: "Founder",
            raw: {},
          };
        }
        return {
          name: "Charles Packer",
          linkedinUrl: "http://www.linkedin.com/in/charles-packer",
          title: "Co-Founder & CEO",
          raw: {},
        };
      },
      async search(_q: SearchQuery): Promise<SearchResult[]> {
        return [];
      },
    };

    const c = companies.create({
      slug: "rosterco",
      name: "RosterCo",
      domain: "rosterco.com",
      status: "new",
    });
    const r = await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    const names = r.people.map((p) => p.person.name);
    expect(names).toEqual(["Charles Packer"]);
    expect(names).not.toContain("Information Security");

    const rows = people.list({ companyId: c.id });
    expect(rows.find((p) => p.name === "Information Security")).toBeUndefined();

    expect(r.notes.join(" ")).toContain("Information Security");
    expect(r.notes.join(" ")).toContain("org/role noise");
  });

  it("degrades gracefully when the company has no linkedin_url", async () => {
    const c = companies.create({ slug: "ghost", name: "Ghost", status: "new" });
    const r = await enrichCompany({ companies, people, provider }, c.id, { baseDir });

    // Company deep-dive still written + status advanced, but no people found.
    expect(existsSync(join(baseDir, "companies", "ghost.md"))).toBe(true);
    expect(r.company.status).toBe("enriched");
    expect(r.people).toHaveLength(0);
    expect(r.notes.join(" ")).toContain("linkedin_url");
  });
});
