import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import {
  createAppMetaRepo,
  type AppMetaRepo,
} from "../src/db/app-meta-repository";
import { createTestDb } from "./helpers";
import { FakeProvider } from "../src/providers";
import {
  refresh,
  newCompaniesSince,
  CsvSource,
  fakeStartupsGallerySource,
  StartupsGallerySource,
  type StartupsGalleryRecord,
} from "../src/sources";

// --- A startups.gallery fixture batch (fed offline, no scraping) ---
const GALLERY_RECORDS: StartupsGalleryRecord[] = [
  {
    name: "Anthropic",
    tagline: "AI safety lab",
    category: "AI",
    stage: "Series C",
    location: "San Francisco",
    website: "https://www.anthropic.com",
    // a gallery profile URL — deliberately NOT the company's domain
    galleryUrl: "https://startups.gallery/companies/anthropic",
  },
  {
    name: "Giga",
    tagline: "AI support agents",
    category: "AI",
    stage: "Seed",
    location: "San Francisco",
    // no website → identity resolved by name via the provider
    galleryUrl: "https://startups.gallery/companies/gigaml",
  },
  // a nameless row that the adapter must drop
  { name: "  " },
];

describe("startups.gallery source adapter", () => {
  it("normalizes records and never treats a gallery URL as the domain", async () => {
    const source = fakeStartupsGallerySource(GALLERY_RECORDS);
    const out = await source.fetch();

    expect(source.kind).toBe("startups_gallery");
    expect(out.map((c) => c.name)).toEqual(["Anthropic", "Giga"]); // nameless dropped

    const anthropic = out[0];
    expect(anthropic.domain).toBe("anthropic.com"); // from its own website
    expect(anthropic.description).toContain("AI safety lab");

    const giga = out[1];
    expect(giga.domain).toBeUndefined(); // no website; gallery URL is NOT a domain
  });

  it("throws an actionable error when no fetcher is configured", async () => {
    const source = new StartupsGallerySource();
    await expect(source.fetch()).rejects.toThrow(/fetcher/i);
  });
});

describe("refresh pipeline", () => {
  let companies: CompanyRepo;
  let appMeta: AppMetaRepo;
  let provider: FakeProvider;

  beforeEach(async () => {
    const db = await createTestDb();
    companies = createCompanyRepo(db);
    appMeta = createAppMetaRepo(db);
    provider = new FakeProvider();
  });

  it("fetches → inserts as new → resolves identity, tagging the source kind", async () => {
    const source = fakeStartupsGallerySource(GALLERY_RECORDS);
    const r = await refresh({ companies, appMeta, provider }, [source], { now: 5000 });

    expect(r.inserted).toBe(2);
    expect(r.duplicates).toBe(0);

    const rows = await companies.list();
    expect(rows).toHaveLength(2);
    for (const c of rows) {
      expect(c.status).toBe("new");
      expect(c.source).toBe("startups_gallery"); // re-tagged off the default csv
      // resolved by slice 02 (FakeProvider): canonical identity populated
      expect(c.domain).toBeTruthy();
      expect(c.linkedinUrl).toBeTruthy();
    }
    // Anthropic kept its real domain; Giga got one synthesized by the provider.
    const anthropic = await companies.getBySlug("anthropic");
    expect(anthropic?.domain).toBe("anthropic.com");

    // watermark persisted
    expect(r.refreshedAt).toBe(5000);
    expect(await appMeta.getLastRefreshAt()).toBe(5000);
  });

  it("dedupes on canonical identity across sources and re-runs (idempotent)", async () => {
    const gallery = fakeStartupsGallerySource(GALLERY_RECORDS);
    // A CSV that re-lists Anthropic under a different shape but the same domain.
    const csv = new CsvSource({
      csvText: "name,domain\nAnthropic PBC,anthropic.com\n",
      name: "sf-list.csv",
    });

    const first = await refresh({ companies, appMeta, provider }, [gallery], { now: 1000 });
    expect(first.inserted).toBe(2);

    // Second run: gallery again (idempotent) + the CSV (same identity → dupe).
    const second = await refresh(
      { companies, appMeta, provider },
      [gallery, csv],
      { now: 2000 },
    );
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3); // 2 gallery re-runs + 1 csv re-list

    // Still only the two original companies — no duplicates.
    expect(await companies.list()).toHaveLength(2);
    expect(await appMeta.getLastRefreshAt()).toBe(2000);
  });

  it("degrades gracefully when a source fails to fetch", async () => {
    const broken = new StartupsGallerySource(); // no fetcher → throws on fetch
    const ok = fakeStartupsGallerySource(GALLERY_RECORDS);

    const r = await refresh({ companies, appMeta, provider }, [broken, ok], { now: 3000 });

    // the good source still ran; the broken one became a note
    expect(r.inserted).toBe(2);
    const brokenResult = r.sources.find((s) => s.fetched === 0 && s.notes.length > 0);
    expect(brokenResult?.notes[0]).toMatch(/fetcher/i);
    expect(await appMeta.getLastRefreshAt()).toBe(3000);
  });
});

describe("newCompaniesSince — what's new since the last run", () => {
  it("returns only companies created after the watermark, oldest first", async () => {
    const db = await createTestDb();
    const companies = createCompanyRepo(db);
    const appMeta = createAppMetaRepo(db);
    const provider = new FakeProvider();

    // Two refreshes — one earlier batch, one later batch — proven to straddle a
    // watermark by reading the rows' actual createdAt (no wall-clock assumptions).
    await refresh(
      { companies, appMeta, provider },
      [fakeStartupsGallerySource(GALLERY_RECORDS)],
    );
    await refresh(
      { companies, appMeta, provider },
      [fakeStartupsGallerySource([{ name: "Cartsense", website: "https://cartsense.ai" }])],
    );

    const cartsense = (await companies.getBySlug("cartsense"))!;

    // A watermark just below Cartsense's createdAt always returns it (strict >).
    const fresh = await newCompaniesSince(companies, cartsense.createdAt - 1);
    expect(fresh.map((c) => c.name)).toContain("Cartsense");

    // A watermark AT Cartsense's createdAt excludes it (and everything older) —
    // the row is no longer "new since the last run". Timing-independent.
    expect(
      (await newCompaniesSince(companies, cartsense.createdAt)).map((c) => c.name),
    ).not.toContain("Cartsense");

    // A watermark at/above the freshest row → nothing is new since the last run.
    const newest = Math.max(...(await companies.list()).map((c) => c.createdAt));
    expect(await newCompaniesSince(companies, newest)).toHaveLength(0);

    // The result is ordered oldest-first (stable for the digest).
    const all = await newCompaniesSince(companies, undefined);
    expect(all.map((c) => c.createdAt)).toEqual(
      [...all.map((c) => c.createdAt)].sort((a, b) => a - b),
    );

    // A null watermark (first ever run) means "everything is new".
    expect(all).toHaveLength(3);
  });
});
