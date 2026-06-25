import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";
import { FakeProvider } from "../src/providers";
import type { CompanyQuery, CompanyResolution, EnrichmentProvider } from "../src/providers/types";
import { parseCsv, parseCsvRecords } from "../src/import/csv";
import {
  applyMapping,
  extractResolveHints,
  identityMap,
  type ColumnMap,
} from "../src/import/mapping";
import { importCsv } from "../src/import/import";

// --- Two genuinely different CSV shapes (issue 03 acceptance) ---

// Shape A: a funding feed. Headers are quirky; domain must be derived from a
// messy website cell and the round vocabulary normalized.
const FUNDING_CSV = `Company,Round Type,Amount,Date,Lead Investor,Website
Anthropic,series-a,"$450M","2026-05-01",Spark Capital,https://www.anthropic.com/careers
Giga,seed,"$10M","2026-04-02",Initialized,http://giga.com
`;

// Shape B: a curated SF list. Different headers, a combined "City, Stage" cell
// to split, and a domain to pull from a path-y URL.
const SF_CSV = `Name,Description,Category,City / Stage,URL
Anthropic,"AI safety lab",AI,"San Francisco / Series A",anthropic.com
Giga,"AI support agents",AI,"San Francisco / Seed",https://www.giga.com/about
`;

// Mapping for shape A — supplied by the skill, NOT inferred by the importer.
const fundingMap: ColumnMap = {
  name: "Company",
  latestRound: {
    from: "Round Type",
    // normalize an unfamiliar round vocabulary
    transform: ({ "Round Type": r }) => {
      const v = r.toLowerCase();
      if (v.startsWith("series-")) return `Series ${v.slice("series-".length).toUpperCase()}`;
      if (v === "seed") return "Seed";
      return r;
    },
  },
  latestAmount: "Amount",
  lastFundingDate: "Date",
  leadInvestor: "Lead Investor",
  websiteUrl: "Website",
  // derive a clean apex domain from a messy URL
  domain: {
    from: "Website",
    transform: ({ Website }) => domainFromUrl(Website),
  },
};

// Mapping for shape B — a DIFFERENT shape resolving to the SAME identities.
const sfMap: ColumnMap = {
  name: "Name",
  description: "Description",
  category: "Category",
  // split a combined cell
  location: { from: "City / Stage", transform: ({ "City / Stage": v }) => v.split("/")[0] },
  stage: { from: "City / Stage", transform: ({ "City / Stage": v }) => v.split("/")[1] },
  domain: { from: "URL", transform: ({ URL }) => domainFromUrl(URL) },
};

function domainFromUrl(raw: string): string | undefined {
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

describe("CSV parser (Node-only, no deps)", () => {
  it("handles quotes, embedded commas, and CRLF", () => {
    const text = 'A,B\r\n"x,y","line\nbreak"\r\n1,2\r\n';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["A", "B"]);
    expect(rows[0]).toEqual({ A: "x,y", B: "line\nbreak" });
    expect(rows[1]).toEqual({ A: "1", B: "2" });
  });

  it("unescapes doubled quotes and strips a BOM", () => {
    const text = '﻿Name\n"She said ""hi"""\n';
    const recs = parseCsvRecords(text);
    expect(recs[0]).toEqual(["Name"]);
    expect(recs[1]).toEqual(['She said "hi"']);
  });

  it("pads ragged rows with empty strings", () => {
    const { rows } = parseCsv("A,B,C\n1,2\n");
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "" });
  });
});

describe("applyMapping (the supplied-mapping seam)", () => {
  it("applies a transform that derives a domain from a messy URL", () => {
    const { rows } = parseCsv(FUNDING_CSV);
    const out = applyMapping(fundingMap, rows[0]);
    expect(out.name).toBe("Anthropic");
    expect(out.domain).toBe("anthropic.com");
    expect(out.latestRound).toBe("Series A");
    expect(out.latestAmount).toBe("$450M");
  });

  it("identityMap maps only headers that already equal canonical fields", () => {
    const map = identityMap(["name", "domain", "Round Type", "category"]);
    expect(map).toEqual({ name: "name", domain: "domain", category: "category" });
    // "Round Type" is NOT a canonical field name, so it is not mapped — no
    // heuristic synonym table exists.
    expect(map).not.toHaveProperty("latestRound");
  });
});

describe("importCsv (parse → map → resolve → dedupe → insert as new)", () => {
  let repo: CompanyRepo;
  const provider = new FakeProvider();

  beforeEach(() => {
    repo = createCompanyRepo(createTestDb());
  });

  it("imports a shaped CSV: rows land as new/csv, resolved to a canonical identity", async () => {
    const res = await importCsv(repo, provider, FUNDING_CSV, fundingMap, {
      sourceDetail: "funding_2026.csv",
    });

    expect(res.inserted).toBe(2);
    expect(res.duplicates).toBe(0);

    const all = repo.list();
    expect(all).toHaveLength(2);
    for (const c of all) {
      expect(c.status).toBe("new");
      expect(c.source).toBe("csv");
      expect(c.sourceDetail).toBe("funding_2026.csv");
      // resolved to a canonical key (domain from the mapping, linkedin from the provider)
      expect(c.domain).toBeTruthy();
      expect(c.linkedinUrl).toBeTruthy();
    }
    const anthropic = repo.list().find((c) => c.name === "Anthropic")!;
    expect(anthropic.domain).toBe("anthropic.com");
    expect(anthropic.latestRound).toBe("Series A");
  });

  it("dedupes on the canonical identity, not the name", async () => {
    // Pre-seed a company that already owns anthropic.com under a DIFFERENT name.
    repo.create({
      slug: "claude-co",
      name: "Claude Co",
      domain: "anthropic.com",
      status: "interesting",
      source: "manual",
    });

    const res = await importCsv(repo, provider, FUNDING_CSV, fundingMap);

    // Anthropic row is a duplicate by domain (despite the name mismatch); only Giga inserts.
    expect(res.duplicates).toBe(1);
    expect(res.inserted).toBe(1);
    expect(repo.list().filter((c) => c.domain === "anthropic.com")).toHaveLength(1);
    // existing row untouched
    expect(repo.getBySlug("claude-co")!.status).toBe("interesting");
  });

  it("is idempotent: re-importing the same CSV creates no duplicates", async () => {
    const first = await importCsv(repo, provider, FUNDING_CSV, fundingMap);
    expect(first.inserted).toBe(2);

    const second = await importCsv(repo, provider, FUNDING_CSV, fundingMap);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);

    expect(repo.list()).toHaveLength(2);
  });

  it("mixed-shape import: two different supplied mappings resolve to the same identities", async () => {
    const a = await importCsv(repo, provider, FUNDING_CSV, fundingMap);
    expect(a.inserted).toBe(2);

    // Same two companies, different CSV shape + different mapping.
    const b = await importCsv(repo, provider, SF_CSV, sfMap);
    expect(b.inserted).toBe(0);
    expect(b.duplicates).toBe(2);

    // Still exactly two rows, keyed on canonical domain.
    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((c) => c.domain))).toEqual(
      new Set(["anthropic.com", "giga.com"]),
    );
  });

  it("dedupes WITHIN a single import when two rows resolve to one identity", async () => {
    const dupeCsv = `Company,Website
Anthropic,https://anthropic.com/careers
Anthropic (Public Benefit),https://www.anthropic.com
`;
    const map: ColumnMap = {
      name: "Company",
      domain: { from: "Website", transform: ({ Website }) => domainFromUrl(Website) },
    };
    const res = await importCsv(repo, provider, dupeCsv, map);
    expect(res.inserted).toBe(1);
    expect(res.duplicates).toBe(1);
    expect(repo.list()).toHaveLength(1);
  });

  it("skips rows that map to no company name", async () => {
    const csv = `Company,Website\n,https://nothing.com\nGiga,https://giga.com\n`;
    const map: ColumnMap = {
      name: "Company",
      domain: { from: "Website", transform: ({ Website }) => domainFromUrl(Website) },
    };
    const res = await importCsv(repo, provider, csv, map);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
  });
});

// --- Transient aggregator-URL hint → data-cleansing crawl (ADR-0003 §1) ---

describe("extractResolveHints (the transient hint channel)", () => {
  it("reads the aggregatorUrl hint, which is NOT a mappable company field", () => {
    const { rows } = parseCsv(`Name,Page\nParadigm,https://startups.gallery/companies/paradigm\n`);
    const map: ColumnMap = { name: "Name", aggregatorUrl: "Page" };

    // applyMapping never produces the hint — it is not a company column.
    const mapped = applyMapping(map, rows[0]);
    expect(mapped).not.toHaveProperty("aggregatorUrl");

    // extractResolveHints reads it transiently from the same row.
    const hints = extractResolveHints(map, rows[0]);
    expect(hints.aggregatorUrl).toBe("https://startups.gallery/companies/paradigm");
  });
});

describe("importCsv data-cleansing crawl (aggregator URL is transient, never stored)", () => {
  // A CSV that carries ONLY a name + an aggregator page (no clean domain).
  const AGG_CSV = `Name,Page
Paradigm,https://startups.gallery/companies/paradigm
`;
  const aggMap: ColumnMap = { name: "Name", aggregatorUrl: "Page" };

  it("anchors domain/website on the CRAWL, never name resolution, and never persists the URL", async () => {
    let crawledUrl: string | undefined;
    const crawl = async (url: string) => {
      crawledUrl = url;
      return { domain: "paradigmai.com", websiteUrl: "https://paradigmai.com" };
    };

    const repo = createCompanyRepo(createTestDb());
    // A provider that would resolve a DIFFERENT (wrong) domain by name, so the
    // assertions prove the crawl won, not name resolution.
    const wrongByName = new FakeProvider({
      companies: {
        paradigm: {
          domain: "paradigm.xyz",
          linkedinUrl: "https://www.linkedin.com/company/paradigm-vc",
          via: "fake",
        },
      },
    });

    const res = await importCsv(repo, wrongByName, AGG_CSV, aggMap, { crawl });

    expect(res.inserted).toBe(1);
    expect(crawledUrl).toBe("https://startups.gallery/companies/paradigm");

    const paradigm = repo.list().find((c) => c.name === "Paradigm")!;
    // Identity comes from the CRAWL, not the (wrong) name resolution.
    expect(paradigm.domain).toBe("paradigmai.com");
    expect(paradigm.websiteUrl).toBe("https://paradigmai.com");

    // The aggregator URL is NEVER persisted on any column.
    const serialized = JSON.stringify(paradigm);
    expect(serialized).not.toContain("startups.gallery");
  });

  it("a crawl that returns undefined leaves the company unresolved (domain stays null)", async () => {
    const crawl = async () => undefined;

    // A provider that also yields NO domain by name, so nothing fills it in —
    // a null domain is the 'unresolved' set (no separate status/column).
    const blindProvider: EnrichmentProvider = {
      name: "blind",
      async resolveCompany(_q: CompanyQuery): Promise<CompanyResolution> {
        return { via: "blind" };
      },
      async getProfile() {
        throw new Error("not used");
      },
      async getEmployees() {
        return [];
      },
      async search() {
        return [];
      },
    };

    const repo = createCompanyRepo(createTestDb());
    const res = await importCsv(repo, blindProvider, AGG_CSV, aggMap, { crawl });

    expect(res.inserted).toBe(1);
    const paradigm = repo.list().find((c) => c.name === "Paradigm")!;
    expect(paradigm.domain).toBeNull();
    expect(paradigm.websiteUrl).toBeNull();
  });
});
