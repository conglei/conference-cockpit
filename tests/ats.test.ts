import { describe, it, expect } from "vitest";
import { detectAts, fetchAtsJobs } from "../src/providers/ats";
import {
  createCompanyRepo,
  createRoleRepo,
  type CompanyRepo,
  type RoleRepo,
} from "../src/db/repository";
import { findJobsFromAts } from "../src/roles/find-jobs";
import { createTestDb } from "./helpers";

/** A `fetch` stub that returns one JSON body with the given status (default 200). */
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("detectAts", () => {
  it("parses an Ashby board URL", () => {
    expect(detectAts("https://jobs.ashbyhq.com/gigaml")).toEqual({
      provider: "ashby",
      token: "gigaml",
    });
  });

  it("parses both Greenhouse host forms", () => {
    expect(detectAts("https://boards.greenhouse.io/newlimit")).toEqual({
      provider: "greenhouse",
      token: "newlimit",
    });
    expect(detectAts("https://job-boards.greenhouse.io/newlimit")).toEqual({
      provider: "greenhouse",
      token: "newlimit",
    });
  });

  it("parses a Lever board URL", () => {
    expect(detectAts("https://jobs.lever.co/collate")).toEqual({
      provider: "lever",
      token: "collate",
    });
  });

  it("parses a Workable subdomain", () => {
    expect(detectAts("https://acme.workable.com")).toEqual({
      provider: "workable",
      token: "acme",
    });
  });

  it("returns undefined for an on-domain /careers page", () => {
    expect(detectAts("https://acme.com/careers")).toBeUndefined();
  });

  it("returns undefined for a non-URL", () => {
    expect(detectAts("not a url")).toBeUndefined();
  });
});

describe("fetchAtsJobs", () => {
  it("normalizes an Ashby payload", async () => {
    const fetchImpl = fakeFetch({
      jobs: [
        {
          title: "Founding Engineer",
          location: "San Francisco",
          jobUrl: "https://jobs.ashbyhq.com/giga/abc",
          id: "abc-123",
          publishedAt: "2026-06-01T00:00:00Z",
          descriptionPlain: "Build things.",
        },
      ],
    });
    const jobs = await fetchAtsJobs("https://jobs.ashbyhq.com/giga", fetchImpl);
    expect(jobs).toEqual([
      {
        title: "Founding Engineer",
        companyName: "",
        location: "San Francisco",
        link: "https://jobs.ashbyhq.com/giga/abc",
        externalId: "abc-123",
        postedDate: "2026-06-01T00:00:00Z",
        description: "Build things.",
      },
    ]);
  });

  it("normalizes a Greenhouse payload (location.name, numeric id, content)", async () => {
    const fetchImpl = fakeFetch({
      jobs: [
        {
          title: "Backend Engineer",
          location: { name: "Remote" },
          absolute_url: "https://boards.greenhouse.io/newlimit/jobs/42",
          id: 42,
          updated_at: "2026-05-20T00:00:00Z",
          content: "<p>Job</p>",
        },
      ],
    });
    const jobs = await fetchAtsJobs("https://boards.greenhouse.io/newlimit", fetchImpl);
    expect(jobs).toEqual([
      {
        title: "Backend Engineer",
        companyName: "",
        location: "Remote",
        link: "https://boards.greenhouse.io/newlimit/jobs/42",
        externalId: "42",
        postedDate: "2026-05-20T00:00:00Z",
        description: "<p>Job</p>",
      },
    ]);
  });

  it("normalizes a Lever payload (bare array, categories.location, ms epoch)", async () => {
    const created = Date.UTC(2026, 0, 2); // 2026-01-02
    const fetchImpl = fakeFetch([
      {
        text: "Product Engineer",
        categories: { location: "New York", team: "Eng" },
        hostedUrl: "https://jobs.lever.co/collate/xyz",
        id: "xyz",
        createdAt: created,
        descriptionPlain: "Ship.",
      },
    ]);
    const jobs = await fetchAtsJobs("https://jobs.lever.co/collate", fetchImpl);
    expect(jobs).toEqual([
      {
        title: "Product Engineer",
        companyName: "",
        location: "New York",
        link: "https://jobs.lever.co/collate/xyz",
        externalId: "xyz",
        postedDate: new Date(created).toISOString(),
        description: "Ship.",
      },
    ]);
  });

  it("returns [] on a non-200 response", async () => {
    const fetchImpl = fakeFetch({ jobs: [] }, 404);
    const jobs = await fetchAtsJobs("https://jobs.ashbyhq.com/giga", fetchImpl);
    expect(jobs).toEqual([]);
  });

  it("returns [] for a non-ATS recruiting_website (no detection)", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const jobs = await fetchAtsJobs("https://acme.com/careers", fetchImpl);
    expect(jobs).toEqual([]);
    expect(called).toBe(false); // no detection → never hits the network
  });

  it("never throws when fetch rejects", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchAtsJobs("https://jobs.lever.co/collate", fetchImpl)).resolves.toEqual([]);
  });
});

describe("findJobsFromAts", () => {
  let companies: CompanyRepo;
  let roles: RoleRepo;

  function setup() {
    const db = createTestDb();
    companies = createCompanyRepo(db);
    roles = createRoleRepo(db);
  }

  it('inserts roles with source "ats" and links them to the company', async () => {
    setup();
    const company = companies.create({
      slug: "giga",
      name: "Giga",
      recruitingWebsite: "https://jobs.ashbyhq.com/giga",
    });
    const fetchImpl = fakeFetch({
      jobs: [
        { title: "Engineer A", location: "SF", jobUrl: "https://x/a", id: "a", publishedAt: "2026-06-01" },
        { title: "Engineer B", location: "SF", jobUrl: "https://x/b", id: "b", publishedAt: "2026-06-01" },
      ],
    });

    const r = await findJobsFromAts({ companies, roles, fetchImpl }, company.id);
    expect(r.inserted).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
    expect(r.inserted.every((role) => role.source === "ats")).toBe(true);
    expect(r.inserted.every((role) => role.companyId === company.id)).toBe(true);
  });

  it("dedupes on external_id across runs", async () => {
    setup();
    const company = companies.create({
      slug: "giga",
      name: "Giga",
      recruitingWebsite: "https://jobs.ashbyhq.com/giga",
    });
    const fetchImpl = fakeFetch({
      jobs: [{ title: "Engineer A", location: "SF", jobUrl: "https://x/a", id: "a", publishedAt: "x" }],
    });

    const first = await findJobsFromAts({ companies, roles, fetchImpl }, company.id);
    expect(first.inserted).toHaveLength(1);

    const second = await findJobsFromAts({ companies, roles, fetchImpl }, company.id);
    expect(second.inserted).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
  });

  it("notes and skips a company with no recruiting_website", async () => {
    setup();
    const company = companies.create({ slug: "nope", name: "Nope" });
    const r = await findJobsFromAts({ companies, roles, fetchImpl: fakeFetch({}) }, company.id);
    expect(r.inserted).toHaveLength(0);
    expect(r.notes.join(" ")).toMatch(/no recruiting_website/);
  });
});
