import { describe, it, expect } from "vitest";
import {
  FakeProvider,
  HarvestProvider,
  SearchApiProvider,
  createProvider,
  ProviderConfigError,
  PROVIDER_KINDS,
} from "../src/providers";
import { CostMeter } from "../src/providers/cost";
import type { JobSearchResult } from "../src/providers/types";

describe("FakeProvider (offline fixtures)", () => {
  it("resolves a known company from fixtures", async () => {
    const p = new FakeProvider();
    const r = await p.resolveCompany({ name: "Anthropic" });
    expect(r.domain).toBe("anthropic.com");
    expect(r.linkedinUrl).toContain("linkedin.com/company/");
    expect(r.via).toBe("fake");
  });

  it("synthesizes a deterministic resolution for an unknown company", async () => {
    const p = new FakeProvider();
    const r = await p.resolveCompany({ name: "Some New Co" });
    expect(r.domain).toBe("some-new-co.com");
    expect(r.linkedinUrl).toBe("https://www.linkedin.com/company/some-new-co");
  });

  it("derives the domain from a known website url", async () => {
    const p = new FakeProvider();
    const r = await p.resolveCompany({
      name: "Branded Co",
      websiteUrl: "https://www.branded.io/about",
    });
    expect(r.domain).toBe("branded.io");
  });

  it("accepts caller-injected fixtures (override default)", async () => {
    const p = new FakeProvider({
      companies: { "acme rockets": { domain: "acme.dev", via: "fake" } },
    });
    const r = await p.resolveCompany({ name: "Acme Rockets" });
    expect(r.domain).toBe("acme.dev");
  });

  it("returns profile, employees, and search fixtures", async () => {
    const p = new FakeProvider();
    const profile = await p.getProfile({
      linkedinUrl: "https://www.linkedin.com/in/jane-founder",
    });
    expect(profile.title).toBe("Co-founder & CEO");

    const roster = await p.getEmployees({
      companyLinkedinUrl: "https://www.linkedin.com/company/gigaml",
    });
    expect(roster.length).toBeGreaterThanOrEqual(2);

    const jobs = await p.search({ q: "Founding Engineer", engine: "jobs" });
    expect(jobs).toHaveLength(1);
  });
});

describe("provider selection (config, not code)", () => {
  it("createProvider maps env-style kind strings to adapters", () => {
    expect(createProvider("fake").name).toBe("fake");
    expect(createProvider("harvest").name).toBe("harvest");
    expect(createProvider("searchapi").name).toBe("searchapi");
    expect(createProvider("apollo").name).toBe("apollo");
  });

  it("defaults to fake when unset", () => {
    expect(createProvider(undefined).name).toBe("fake");
  });

  it("lists the valid kinds and rejects unknown ones with an actionable error", () => {
    expect([...PROVIDER_KINDS]).toEqual(["fake", "harvest", "searchapi", "apollo"]);
    expect(() => createProvider("nope")).toThrow(ProviderConfigError);
    expect(() => createProvider("nope")).toThrow(/ENRICHMENT_PROVIDER/);
  });
});

describe("real adapters degrade gracefully without keys", () => {
  it("HarvestProvider names HARVESTAPI_KEY when unconfigured", async () => {
    const p = new HarvestProvider({ apiKey: undefined });
    await expect(p.resolveCompany({ name: "Anthropic" })).rejects.toThrow(ProviderConfigError);
    await expect(p.resolveCompany({ name: "Anthropic" })).rejects.toThrow(/HARVESTAPI_KEY/);
  });

  it("SearchApiProvider names SEARCHAPI_KEY when unconfigured", async () => {
    const p = new SearchApiProvider({ apiKey: undefined });
    await expect(p.search({ q: "x", engine: "web" })).rejects.toThrow(ProviderConfigError);
    await expect(p.search({ q: "x", engine: "web" })).rejects.toThrow(/SEARCHAPI_KEY/);
  });

  it("each adapter directs you to the other for unsupported capabilities", async () => {
    const harvest = new HarvestProvider({ apiKey: "fake-key" });
    await expect(harvest.search({ q: "x", engine: "web" })).rejects.toThrow(/SearchAPI/);

    const search = new SearchApiProvider({ apiKey: "fake-key" });
    await expect(
      search.getEmployees({ companyLinkedinUrl: "https://x" }),
    ).rejects.toThrow(/Harvest/);
  });
});

describe("adapters parse documented HTTP shapes (injected fetch)", () => {
  function okJson(body: unknown): typeof fetch {
    return (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => body,
      }) as unknown as Response) as unknown as typeof fetch;
  }

  // Live HarvestAPI wraps single-entity payloads under `element`; resolving by a
  // known LinkedIn URL is the single-call path.
  it("HarvestProvider maps a company payload to a resolution", async () => {
    const p = new HarvestProvider({
      apiKey: "k",
      fetchImpl: okJson({
        element: {
          website: "https://www.acme.com",
          linkedinUrl: "https://www.linkedin.com/company/acme",
          employeeCount: 12,
          tagline: "Rockets.",
        },
      }),
    });
    const r = await p.resolveCompany({
      name: "Acme",
      linkedinUrl: "https://www.linkedin.com/company/acme",
    });
    expect(r.domain).toBe("acme.com");
    expect(r.linkedinUrl).toBe("https://www.linkedin.com/company/acme");
    expect(r.sizeBand).toBe("tiny");
  });

  // getEmployees is triage-only: ONE company lookup + ONE profile-search, and it
  // NEVER fetches profiles (verification is deferred to the enrich step, which
  // pays for one profile per kept founder anyway). It classifies each candidate
  // by headline: exec-line-naming-company → confirmed; investor/other-company →
  // dropped; company-less tagline → returned unconfirmed for later verification.
  it("HarvestProvider triages employees by headline without fetching profiles", async () => {
    const profileCalls: string[] = [];
    const route = (url: string): unknown => {
      if (url.includes("/linkedin/company")) return { element: { id: "777", name: "Acme" } };
      if (url.includes("/linkedin/profile-search"))
        return {
          elements: [
            { linkedinUrl: "https://www.linkedin.com/in/founder", name: "Fay Founder", position: "Co-Founder & CEO at Acme" },
            { linkedinUrl: "https://www.linkedin.com/in/vc", name: "Vic VC", position: "General Partner at Radiate Ventures" },
            { linkedinUrl: "https://www.linkedin.com/in/tagline", name: "Tay Tagline", position: "Building delightful AI" },
          ],
        };
      profileCalls.push(url);
      return { element: {} };
    };
    const fetchImpl = (async (input: string) =>
      ({ ok: true, status: 200, statusText: "OK", json: async () => route(String(input)) }) as unknown as Response) as unknown as typeof fetch;

    const p = new HarvestProvider({ apiKey: "k", fetchImpl });
    const employees = await p.getEmployees({
      companyLinkedinUrl: "https://www.linkedin.com/company/acme",
    });

    // VC dropped for free; founder confirmed; tagline kept as unconfirmed.
    expect(employees.map((e) => e.name).sort()).toEqual(["Fay Founder", "Tay Tagline"]);
    const fay = employees.find((e) => e.name === "Fay Founder");
    const tay = employees.find((e) => e.name === "Tay Tagline");
    expect(fay?.confirmed).toBe(true);
    expect(fay?.companyId).toBe("777");
    expect(tay?.confirmed).toBe(false);
    expect(tay?.companyId).toBe("777");
    // Crucially: zero profile fetches in the roster step.
    expect(profileCalls).toHaveLength(0);
  });

  // The cost meter records billable calls by kind: company + profile-search here,
  // and the company resolve path bills one company lookup.
  it("HarvestProvider records billable calls in the cost meter", async () => {
    const route = (url: string): unknown => {
      if (url.includes("/linkedin/company")) return { element: { id: "777", name: "Acme" } };
      return { elements: [] };
    };
    const fetchImpl = (async (input: string) =>
      ({ ok: true, status: 200, statusText: "OK", json: async () => route(String(input)) }) as unknown as Response) as unknown as typeof fetch;

    const meter = new CostMeter();
    const p = new HarvestProvider({ apiKey: "k", fetchImpl, meter });
    await p.getEmployees({ companyLinkedinUrl: "https://www.linkedin.com/company/acme" });
    const s = meter.summary();
    expect(s.counts.company).toBe(1);
    expect(s.counts.profileSearch).toBe(1);
    expect(s.totalUsd).toBeCloseTo(0.008, 6);
  });

  // 429 (rate-limit) is transient → retried with backoff until it succeeds.
  it("HarvestProvider retries a 429 and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3)
        return { ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ element: { id: "1" } }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const p = new HarvestProvider({
      apiKey: "k",
      fetchImpl,
      retry: { retries: 5, minTimeout: 1, factor: 1 },
    });
    const r = await p.resolveCompany({
      name: "X",
      linkedinUrl: "https://www.linkedin.com/company/x",
    });
    expect(calls).toBe(3); // two 429s, then the 200
    expect(r.linkedinUrl).toBeUndefined(); // element had only an id; that's fine
  });

  // 404 is a real config error → aborted immediately, NOT retried.
  it("HarvestProvider does not retry a 404", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    const p = new HarvestProvider({
      apiKey: "k",
      fetchImpl,
      retry: { retries: 5, minTimeout: 1 },
    });
    await expect(
      p.getProfile({ linkedinUrl: "https://www.linkedin.com/in/x" }),
    ).rejects.toBeInstanceOf(ProviderConfigError);
    expect(calls).toBe(1);
  });

  it("SearchApiProvider maps google_jobs results", async () => {
    const p = new SearchApiProvider({
      apiKey: "k",
      fetchImpl: okJson({
        jobs: [
          {
            title: "Founding Engineer",
            company_name: "Acme",
            location: "SF",
            job_id: "abc",
            apply_link: "https://acme.com/jobs/1",
          },
        ],
      }),
    });
    const jobs = await p.search({ q: "founding engineer", engine: "jobs" });
    expect(jobs[0]).toMatchObject({ companyName: "Acme", externalId: "abc" });
  });

  // The company element already carries the numeric id; resolveCompany surfaces
  // it as linkedinCompanyId (stringified), even when it arrives as a number.
  it("HarvestProvider resolveCompany returns linkedinCompanyId (issue #36)", async () => {
    const p = new HarvestProvider({
      apiKey: "k",
      fetchImpl: okJson({
        element: {
          id: 1815218,
          website: "https://www.acme.com",
          linkedinUrl: "https://www.linkedin.com/company/acme",
          employeeCount: 12,
        },
      }),
    });
    const r = await p.resolveCompany({
      name: "Acme",
      linkedinUrl: "https://www.linkedin.com/company/acme",
    });
    expect(r.linkedinCompanyId).toBe("1815218");
  });

  // Jobs search hits /linkedin/job-search, scopes by companyId, parses the
  // documented element shape into JobSearchResult[], and meters one call.
  it("HarvestProvider jobs search parses /linkedin/job-search and meters it (issue #36)", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string) => {
      seen.push(String(input));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          elements: [
            {
              id: "job-1",
              title: "Founding Engineer",
              url: "https://www.linkedin.com/jobs/view/job-1",
              company: { name: "Acme" },
              location: { linkedinText: "San Francisco, CA" },
              postedDate: "2026-06-20",
            },
          ],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const meter = new CostMeter();
    const p = new HarvestProvider({ apiKey: "k", fetchImpl, meter });
    const jobs = (await p.search({
      q: "engineer",
      engine: "jobs",
      companyId: "1815218",
      experienceLevel: "mid-senior",
    })) as JobSearchResult[];

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Founding Engineer",
      companyName: "Acme",
      location: "San Francisco, CA",
      link: "https://www.linkedin.com/jobs/view/job-1",
      externalId: "job-1",
      postedDate: "2026-06-20",
    });
    // The request scoped by companyId + experienceLevel against job-search.
    expect(seen[0]).toContain("/linkedin/job-search");
    expect(seen[0]).toContain("companyId=1815218");
    expect(seen[0]).toContain("experienceLevel=mid-senior");
    // Exactly one billable jobSearch call.
    expect(meter.summary().counts.jobSearch).toBe(1);
  });

  // The web engine still has no harvest path — it points at SearchAPI.
  it("HarvestProvider rejects a web search with an actionable error (issue #36)", async () => {
    const p = new HarvestProvider({ apiKey: "k", fetchImpl: okJson({}) });
    await expect(p.search({ q: "x", engine: "web" })).rejects.toThrow(/SearchAPI/);
  });

  it("real adapter surfaces a non-2xx as an actionable ProviderConfigError", async () => {
    const failing = (async () =>
      ({ ok: false, status: 401, statusText: "Unauthorized" }) as unknown as Response) as unknown as typeof fetch;
    const p = new HarvestProvider({ apiKey: "bad", fetchImpl: failing });
    await expect(p.resolveCompany({ name: "Acme" })).rejects.toThrow(/401/);
  });
});
