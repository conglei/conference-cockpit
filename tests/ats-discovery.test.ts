import { describe, it, expect } from "vitest";
import { tokenCandidates, discoverAtsBoardUrl } from "../src/roles/ats-discovery";

describe("tokenCandidates", () => {
  it("produces alnum + hyphenated candidates from name/domain/slug", () => {
    const t = tokenCandidates({ name: "Resolve AI", domain: "resolve.ai", slug: "resolve-ai" });
    expect(t).toContain("resolveai"); // alnum(name)
    expect(t).toContain("resolve-ai"); // hyphen(name)/slug
    expect(t).toContain("resolve"); // domain base
  });
});

describe("discoverAtsBoardUrl cascade", () => {
  it("tier 1: extracts the board from an existing role URL (no network)", async () => {
    let fetched = false;
    const found = await discoverAtsBoardUrl(
      { name: "Acme", slug: "acme", roleUrls: ["https://jobs.ashbyhq.com/acme/abc-123"] },
      { fetchImpl: (async () => ((fetched = true), new Response("[]"))) as unknown as typeof fetch },
    );
    expect(found?.via).toBe("role-url");
    expect(found?.board).toEqual({ provider: "ashby", token: "acme" });
    expect(found?.url).toBe("https://jobs.ashbyhq.com/acme");
    expect(fetched).toBe(false); // tier 1 needs no fetch
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
