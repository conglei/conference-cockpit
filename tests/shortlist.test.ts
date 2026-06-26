import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";
import { selectShortlist, hasCoverage, DEFAULT_SHORTLIST_LIMIT } from "../src/scoring";

/** Create a triaged company row with explicit score columns. */
async function makeScored(
  repo: CompanyRepo,
  slug: string,
  patch: {
    overall: number | null;
    founder?: number | null;
    investor?: number | null;
  },
) {
  const c = await repo.create({ slug, name: slug.toUpperCase() });
  return (await repo.update(c.id, {
    scoreOverall: patch.overall,
    scoreFounderQuality: patch.founder ?? null,
    scoreInvestorQuality: patch.investor ?? null,
    scoredAt: Date.now(),
  }))!;
}

describe("selectShortlist — the deep-review tier (rank ∩ coverage)", () => {
  let repo: CompanyRepo;
  beforeEach(async () => {
    repo = createCompanyRepo(await createTestDb());
  });

  it("excludes zero-coverage rows (both co-dominant axes NULL → recovery queue)", async () => {
    await makeScored(repo, "covered", { overall: 0.9, founder: 0.8 });
    await makeScored(repo, "zero-cov", { overall: 0.95, founder: null, investor: null });

    const shortlist = selectShortlist(await repo.list());
    expect(shortlist.map((c) => c.slug)).toEqual(["covered"]);
  });

  it("accepts coverage on either co-dominant axis alone", async () => {
    await makeScored(repo, "founder-only", { overall: 0.7, founder: 0.6, investor: null });
    await makeScored(repo, "investor-only", { overall: 0.6, founder: null, investor: 0.5 });

    expect(hasCoverage((await repo.getBySlug("founder-only"))!)).toBe(true);
    expect(hasCoverage((await repo.getBySlug("investor-only"))!)).toBe(true);

    const shortlist = selectShortlist(await repo.list());
    expect(shortlist.map((c) => c.slug)).toEqual(["founder-only", "investor-only"]);
  });

  it("excludes un-triaged rows (no rubric scoreOverall yet)", async () => {
    await makeScored(repo, "triaged", { overall: 0.5, founder: 0.5 });
    // a row with coverage but no overall — not yet triaged
    await makeScored(repo, "untriaged", { overall: null, founder: 0.9 });
    await repo.create({ slug: "fresh", name: "Fresh" }); // never scored at all

    const shortlist = selectShortlist(await repo.list());
    expect(shortlist.map((c) => c.slug)).toEqual(["triaged"]);
  });

  it("sorts by scoreOverall descending", async () => {
    await makeScored(repo, "low", { overall: 0.3, founder: 0.3 });
    await makeScored(repo, "high", { overall: 0.9, founder: 0.9 });
    await makeScored(repo, "mid", { overall: 0.6, founder: 0.6 });

    const shortlist = selectShortlist(await repo.list());
    expect(shortlist.map((c) => c.slug)).toEqual(["high", "mid", "low"]);
  });

  it("caps at the limit (default 50)", async () => {
    for (let i = 0; i < 60; i++) {
      await makeScored(repo, `c${String(i).padStart(2, "0")}`, { overall: i / 100, founder: 0.5 });
    }
    const capped = selectShortlist(await repo.list());
    expect(capped).toHaveLength(DEFAULT_SHORTLIST_LIMIT);
    // Top of the list is the highest overall (c59).
    expect(capped[0].slug).toBe("c59");

    const tighter = selectShortlist(await repo.list(), { limit: 5 });
    expect(tighter).toHaveLength(5);
  });

  it("filters by minOverall before capping", async () => {
    await makeScored(repo, "weak", { overall: 0.2, founder: 0.5 });
    await makeScored(repo, "ok", { overall: 0.55, founder: 0.5 });
    await makeScored(repo, "strong", { overall: 0.85, founder: 0.5 });

    const shortlist = selectShortlist(await repo.list(), { minOverall: 0.5 });
    expect(shortlist.map((c) => c.slug)).toEqual(["strong", "ok"]);
  });

  it("limit and minOverall compose", async () => {
    await makeScored(repo, "a", { overall: 0.9, founder: 0.5 });
    await makeScored(repo, "b", { overall: 0.8, founder: 0.5 });
    await makeScored(repo, "c", { overall: 0.4, founder: 0.5 });

    const shortlist = selectShortlist(await repo.list(), { minOverall: 0.5, limit: 1 });
    expect(shortlist.map((c) => c.slug)).toEqual(["a"]);
  });
});
