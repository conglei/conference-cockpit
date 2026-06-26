import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";
import {
  FakeProvider,
  HarvestProvider,
  resolveCompany,
  type EnrichmentProvider,
  ProviderConfigError,
} from "../src/providers";

describe("resolveCompany (offline, FakeProvider)", () => {
  let repo: CompanyRepo;

  beforeEach(async () => {
    repo = createCompanyRepo(await createTestDb());
  });

  it("populates domain and linkedin_url through the data layer", async () => {
    const c = await repo.create({ slug: "giga", name: "Giga" });
    expect(c.domain).toBeNull();
    expect(c.linkedinUrl).toBeNull();

    const r = await resolveCompany(repo, c.id, new FakeProvider());

    expect(r.resolved).toBe(true);
    expect(r.via).toBe("fake");
    expect(r.company.domain).toBe("giga.com");
    expect(r.company.linkedinUrl).toBe("https://www.linkedin.com/company/gigaml");

    // persisted, readable back through the repo
    const reread = (await repo.get(c.id))!;
    expect(reread.domain).toBe("giga.com");
    expect(reread.linkedinUrl).toBe("https://www.linkedin.com/company/gigaml");
  });

  it("preserves already-resolved fields and only fills blanks", async () => {
    const c = await repo.create({ slug: "x", name: "Giga", domain: "preset.com" });
    const r = await resolveCompany(repo, c.id, new FakeProvider());
    expect(r.company.domain).toBe("preset.com"); // untouched
    expect(r.company.linkedinUrl).toBe("https://www.linkedin.com/company/gigaml"); // filled
  });

  it("is a no-op when both identity fields are already set", async () => {
    const c = await repo.create({
      slug: "x",
      name: "Giga",
      domain: "preset.com",
      linkedinUrl: "https://www.linkedin.com/company/preset",
    });
    const r = await resolveCompany(repo, c.id, new FakeProvider());
    expect(r.resolved).toBe(false);
  });

  it("uses the web-search fallback tier when tier 1 leaves blanks", async () => {
    // Primary provider returns nothing; fallback fills both fields.
    const blankPrimary: EnrichmentProvider = {
      name: "blank",
      resolveCompany: async () => ({ via: "blank" }),
      getProfile: async () => ({ name: "", linkedinUrl: "" }),
      getEmployees: async () => [],
      search: async () => [],
    };
    const fallback = new FakeProvider({
      companies: {
        mystery: {
          domain: "mystery.io",
          linkedinUrl: "https://www.linkedin.com/company/mystery",
          via: "fake",
        },
      },
    });

    const c = await repo.create({ slug: "m", name: "Mystery" });
    const r = await resolveCompany(repo, c.id, blankPrimary, { searchProvider: fallback });
    expect(r.resolved).toBe(true);
    expect(r.via).toBe("web-search");
    expect(r.company.domain).toBe("mystery.io");
  });

  it("degrades gracefully when a provider is missing its key", async () => {
    const unconfigured = new HarvestProvider({ apiKey: undefined });
    const c = await repo.create({ slug: "g", name: "Giga" });

    const r = await resolveCompany(repo, c.id, unconfigured);

    expect(r.resolved).toBe(false);
    expect(r.company.domain).toBeNull();
    expect(r.notes.join("\n")).toMatch(/HARVESTAPI_KEY/);
  });

  it("recovers via fallback after tier 1 throws a config error", async () => {
    const unconfigured = new HarvestProvider({ apiKey: undefined });
    const fallback = new FakeProvider();
    const c = await repo.create({ slug: "g", name: "Giga" });

    const r = await resolveCompany(repo, c.id, unconfigured, { searchProvider: fallback });

    expect(r.resolved).toBe(true);
    expect(r.via).toBe("web-search");
    expect(r.company.domain).toBe("giga.com");
    expect(r.notes.join("\n")).toMatch(/HARVESTAPI_KEY/); // tier-1 degradation noted
  });

  it("does not write an identity that collides with another company", async () => {
    // Existing row already owns giga.com + the gigaml LinkedIn.
    await repo.create({
      slug: "existing",
      name: "Existing",
      domain: "giga.com",
      linkedinUrl: "https://www.linkedin.com/company/gigaml",
    });
    const c = await repo.create({ slug: "dupe", name: "Giga" });

    const r = await resolveCompany(repo, c.id, new FakeProvider());

    // Both resolved values collide -> nothing written, recorded as notes.
    expect(r.resolved).toBe(false);
    expect(r.company.domain).toBeNull();
    expect(r.notes.join("\n")).toMatch(/already belongs to company/);
  });

  it("surfaces an unexpected (non-config) provider error as a note, not a throw", async () => {
    const boom: EnrichmentProvider = {
      name: "boom",
      resolveCompany: async () => {
        throw new Error("kaboom");
      },
      getProfile: async () => ({ name: "", linkedinUrl: "" }),
      getEmployees: async () => [],
      search: async () => [],
    };
    const c = await repo.create({ slug: "b", name: "Boom" });
    const r = await resolveCompany(repo, c.id, boom);
    expect(r.resolved).toBe(false);
    expect(r.notes.join("\n")).toMatch(/kaboom/);
  });

  it("ProviderConfigError is the typed graceful-degradation signal", () => {
    expect(new ProviderConfigError("x")).toBeInstanceOf(Error);
  });
});
