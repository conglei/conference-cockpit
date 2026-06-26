import { describe, it, expect } from "vitest";
import { tokenCandidates, discoverAtsBoardUrl, identityMatches } from "../src/roles/ats-discovery";

/** A SearchAPI-like provider returning fixed result links. */
const searchReturning = (...links: string[]) =>
  ({ search: async () => links.map((link) => ({ link })) }) as never;

describe("tokenCandidates", () => {
  it("produces alnum + hyphenated candidates from name/domain/slug", () => {
    const t = tokenCandidates({ name: "Resolve AI", domain: "resolve.ai", slug: "resolve-ai" });
    expect(t).toContain("resolveai"); // alnum(name)
    expect(t).toContain("resolve-ai"); // hyphen(name)/slug
    expect(t).toContain("resolve"); // domain base
  });
});

describe("discoverAtsBoardUrl cascade", () => {
  it("tier 1: extracts the board from an existing (live) role URL", async () => {
    const fetchImpl = (async (url: string) =>
      url.includes("ashbyhq") && url.includes("acme")
        ? new Response(JSON.stringify({ jobs: [{ title: "Engineer", id: "1" }] }))
        : new Response("{}")) as unknown as typeof fetch;
    const found = await discoverAtsBoardUrl(
      { name: "Acme", slug: "acme", roleUrls: ["https://jobs.ashbyhq.com/acme/abc-123"] },
      { fetchImpl },
    );
    expect(found?.via).toBe("role-url");
    expect(found?.board).toEqual({ provider: "ashby", token: "acme" });
    expect(found?.url).toBe("https://jobs.ashbyhq.com/acme");
    expect(found?.jobs.length).toBe(1);
  });

  it("tier 1: falls through a DEAD board URL to the probe", async () => {
    // role-url board has no jobs (e.g. a mis-encoded token); probe finds the live one.
    const fetchImpl = (async (url: string) =>
      url.includes("greenhouse") && url.includes("acme")
        ? new Response(JSON.stringify({ jobs: [{ title: "Engineer", id: 1 }] }))
        : new Response("{}")) as unknown as typeof fetch;
    const found = await discoverAtsBoardUrl(
      { name: "Acme", slug: "acme", domain: "acme.com", roleUrls: ["https://jobs.lever.co/dead/x"] },
      { fetchImpl },
    );
    expect(found?.via).toBe("probe");
    expect(found?.board.provider).toBe("greenhouse");
  });

  it("tier 3: probes endpoints when nothing is known, returns the board with jobs", async () => {
    // Mock fetch: only greenhouse/acme returns a non-empty jobs array.
    const fetchImpl = (async (url: string) => {
      if (url.includes("greenhouse") && url.includes("acme")) {
        return new Response(JSON.stringify({ jobs: [{ title: "Engineer", id: 1 }] }));
      }
      return new Response("{}");
    }) as unknown as typeof fetch;

    const found = await discoverAtsBoardUrl({ name: "Acme", slug: "acme", domain: "acme.com" }, { fetchImpl });
    expect(found?.via).toBe("probe");
    expect(found?.board.provider).toBe("greenhouse");
    expect(found?.board.token).toBe("acme");
  });

  it("returns undefined when no board is found and no search provider is given", async () => {
    const fetchImpl = (async () => new Response("{}")) as unknown as typeof fetch;
    const found = await discoverAtsBoardUrl({ name: "Nobody", slug: "nobody" }, { fetchImpl });
    expect(found).toBeUndefined();
  });
});

describe("identityMatches", () => {
  const keys = (name: string) => [name.toLowerCase().replace(/[^a-z0-9]+/g, "")];
  it("accepts a token that equals / contains a company key", () => {
    expect(identityMatches("togetherai", ["togetherai", "together"])).toBe(true);
    expect(identityMatches("perplexityai", keys("Perplexity"))).toBe(true); // contains
    expect(identityMatches("scale", keys("Scale AI"))).toBe(true); // key contains token
  });
  it("rejects an unrelated token (the collision class)", () => {
    expect(identityMatches("insomniacookies", keys("Daytona"))).toBe(false);
    expect(identityMatches("acme", keys("Daytona"))).toBe(false);
  });
});

describe("discoverAtsBoardUrl identity guard", () => {
  it("tier 4: rejects a web-search hit whose token doesn't identify the company", async () => {
    // The real bug: searching "Daytona" returned jobs.lever.co/insomniacookies.
    const fetchImpl = (async (url: string) =>
      url.includes("insomniacookies")
        ? new Response(JSON.stringify([{ text: "Assistant Manager", id: "1" }]))
        : new Response("{}")) as unknown as typeof fetch;
    const found = await discoverAtsBoardUrl(
      { name: "Daytona", slug: "daytona", domain: "daytona.io" },
      { fetchImpl, searchProvider: searchReturning("https://jobs.lever.co/insomniacookies/x-1") },
    );
    expect(found).toBeUndefined(); // bad board refused, no fallback → none
  });

  it("tier 4: accepts a token-mismatched Greenhouse board when its org name matches", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/boards/codename")) return new Response(JSON.stringify({ name: "Acme" }));
      if (url.includes("codename") && url.includes("/jobs"))
        return new Response(JSON.stringify({ jobs: [{ title: "Engineer", id: 7 }] }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const found = await discoverAtsBoardUrl(
      { name: "Acme", slug: "acme", domain: "acme.com" },
      {
        fetchImpl,
        searchProvider: searchReturning("https://job-boards.greenhouse.io/codename/jobs/9"),
      },
    );
    expect(found?.via).toBe("web-search");
    expect(found?.board).toEqual({ provider: "greenhouse", token: "codename" });
  });
});
