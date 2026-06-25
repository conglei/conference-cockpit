import { describe, it, expect } from "vitest";
import {
  normalizeName,
  recoverDomains,
  type CrawlFn,
  type RecoverDomainsRepo,
} from "../src/providers/recover-domains";

interface Row {
  id: number;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  recruitingWebsite?: string | null;
}

/** A tiny in-memory stand-in for CompanyRepo exposing just list/update. Enforces
 * the real `companies.domain` UNIQUE constraint so collisions are exercised. */
function fakeRepo(rows: Row[]): RecoverDomainsRepo & { rows: Row[] } {
  return {
    rows,
    list: () => rows.map((r) => ({ id: r.id, name: r.name })),
    update(id, patch) {
      const owner = rows.find((r) => r.domain === patch.domain && r.id !== id);
      if (owner) {
        throw Object.assign(
          new Error(`UNIQUE constraint failed: companies.domain`),
          { code: "SQLITE_CONSTRAINT_UNIQUE" },
        );
      }
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.domain = patch.domain;
        row.websiteUrl = patch.websiteUrl;
        if (patch.recruitingWebsite !== undefined) row.recruitingWebsite = patch.recruitingWebsite;
      }
      return row;
    },
  };
}

/** A crawl that resolves a domain per aggregator URL, undefined otherwise. */
function crawlFrom(table: Record<string, string>): CrawlFn {
  return async (url) => {
    const domain = table[url];
    return domain ? { domain, websiteUrl: `https://${domain}` } : undefined;
  };
}

describe("recoverDomains", () => {
  it("overwrites domain + website on a matched, crawlable company", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Paradigm", domain: "fake-paradigm.io", websiteUrl: "https://fake-paradigm.io" },
    ]);
    const map = new Map([[normalizeName("Paradigm"), "https://startups.gallery/c/paradigm"]]);
    const crawl = crawlFrom({ "https://startups.gallery/c/paradigm": "paradigmai.com" });

    const result = await recoverDomains(repo, map, crawl);

    expect(result).toMatchObject({ recovered: 1, unresolved: 0 });
    expect(repo.rows[0].domain).toBe("paradigmai.com");
    expect(repo.rows[0].websiteUrl).toBe("https://paradigmai.com");
  });

  it("persists recruitingWebsite when the crawl returns a recruitingUrl", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Acme", domain: null, websiteUrl: null },
    ]);
    const map = new Map([[normalizeName("Acme"), "u"]]);
    const crawl: CrawlFn = async () => ({
      domain: "acme.com",
      websiteUrl: "https://acme.com",
      recruitingUrl: "https://jobs.ashbyhq.com/acme",
    });

    const result = await recoverDomains(repo, map, crawl);

    expect(result).toMatchObject({ recovered: 1 });
    expect(repo.rows[0].domain).toBe("acme.com");
    expect(repo.rows[0].recruitingWebsite).toBe("https://jobs.ashbyhq.com/acme");
  });

  it("leaves recruitingWebsite unset when the crawl has no recruitingUrl", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Acme", domain: null, websiteUrl: null },
    ]);
    const map = new Map([[normalizeName("Acme"), "u"]]);
    const crawl = crawlFrom({ u: "acme.com" }); // no recruitingUrl

    await recoverDomains(repo, map, crawl);

    expect(repo.rows[0].domain).toBe("acme.com");
    expect(repo.rows[0].recruitingWebsite).toBeUndefined();
  });

  it("leaves a company untouched when the crawl returns undefined (unresolved)", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Giga", domain: "old-giga.com", websiteUrl: "https://old-giga.com" },
    ]);
    const map = new Map([[normalizeName("Giga"), "https://startups.gallery/c/giga"]]);
    const crawl = crawlFrom({}); // crawl resolves nothing

    const result = await recoverDomains(repo, map, crawl);

    expect(result).toMatchObject({ recovered: 0, unresolved: 1 });
    expect(repo.rows[0].domain).toBe("old-giga.com");
    expect(repo.rows[0].websiteUrl).toBe("https://old-giga.com");
  });

  it("skips companies absent from the aggregator-URL map", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Mapped", domain: null, websiteUrl: null },
      { id: 2, name: "Unmapped", domain: "keep.com", websiteUrl: "https://keep.com" },
    ]);
    const map = new Map([[normalizeName("Mapped"), "https://startups.gallery/c/mapped"]]);
    const crawl = crawlFrom({ "https://startups.gallery/c/mapped": "mapped.ai" });

    const result = await recoverDomains(repo, map, crawl);

    expect(result).toMatchObject({ recovered: 1, unresolved: 0 });
    expect(repo.rows[0].domain).toBe("mapped.ai");
    // The unmapped company is never crawled or touched.
    expect(repo.rows[1].domain).toBe("keep.com");
    expect(repo.rows[1].websiteUrl).toBe("https://keep.com");
  });

  it("matches on normalized names (case + punctuation insensitive)", async () => {
    const repo = fakeRepo([
      { id: 1, name: "Mail0 (mail0.com)", domain: null, websiteUrl: null },
    ]);
    // Map key derived from a differently-formatted source name.
    const map = new Map([[normalizeName("mail 0 MAIL0COM"), "u"]]);
    expect(normalizeName("Mail0 (mail0.com)")).toBe(normalizeName("mail 0 MAIL0COM"));
    const crawl = crawlFrom({ u: "0.email" });

    const result = await recoverDomains(repo, map, crawl);

    expect(result.recovered).toBe(1);
    expect(repo.rows[0].domain).toBe("0.email");
  });

  it("reports per-company progress via onResult and respects concurrency", async () => {
    const repo = fakeRepo([
      { id: 1, name: "A", domain: null, websiteUrl: null },
      { id: 2, name: "B", domain: null, websiteUrl: null },
      { id: 3, name: "C", domain: "keep.com", websiteUrl: "https://keep.com" },
    ]);
    const map = new Map([
      [normalizeName("A"), "ua"],
      [normalizeName("B"), "ub"],
      // C deliberately absent from the map.
    ]);
    const crawl = crawlFrom({ ua: "a.com" }); // B resolves nothing

    const events: string[] = [];
    const result = await recoverDomains(repo, map, crawl, {
      concurrency: 1,
      onResult: (e) =>
        events.push(
          e.unmapped ? `unmapped:${e.company.name}` : e.recovered ? `ok:${e.company.name}` : `miss:${e.company.name}`,
        ),
    });

    expect(result).toMatchObject({ recovered: 1, unresolved: 1 });
    expect(events).toContain("ok:A");
    expect(events).toContain("miss:B");
    expect(events).toContain("unmapped:C");
  });

  it("skips a domain collision (UNIQUE) without aborting the batch", async () => {
    // Two companies crawl to the SAME domain (a likely duplicate). The first wins;
    // the second collides on the UNIQUE domain index and is skipped, not fatal.
    const repo = fakeRepo([
      { id: 1, name: "Acme", domain: null, websiteUrl: null },
      { id: 2, name: "Acme Inc", domain: null, websiteUrl: null },
      { id: 3, name: "Other", domain: null, websiteUrl: null },
    ]);
    const map = new Map([
      [normalizeName("Acme"), "u1"],
      [normalizeName("Acme Inc"), "u2"],
      [normalizeName("Other"), "u3"],
    ]);
    const crawl = crawlFrom({ u1: "acme.com", u2: "acme.com", u3: "other.com" });

    const collided: string[] = [];
    const result = await recoverDomains(repo, map, crawl, {
      concurrency: 1, // deterministic order: Acme wins acme.com, Acme Inc collides
      onResult: (e) => e.collidedDomain && collided.push(`${e.company.name}:${e.collidedDomain}`),
    });

    expect(result).toMatchObject({ recovered: 2, unresolved: 0, collided: 1 });
    expect(repo.rows[0].domain).toBe("acme.com"); // Acme got it
    expect(repo.rows[1].domain).toBeNull(); // Acme Inc skipped (collision)
    expect(repo.rows[2].domain).toBe("other.com"); // batch continued
    expect(collided).toEqual(["Acme Inc:acme.com"]);
  });
});
