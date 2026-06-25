import { describe, it, expect } from "vitest";
import { prefilter, prefilterOne, type PrefilterCriteria } from "../src/scoring";
import type { Company } from "../src/db/schema";

// Build a Company row with sensible nulls; override what a test cares about.
function company(over: Partial<Company> = {}): Company {
  const ts = 0;
  return {
    id: 1,
    slug: "co",
    name: "Co",
    domain: null,
    linkedinUrl: null,
    linkedinCompanyId: null,
    websiteUrl: null,
    recruitingWebsite: null,
    description: null,
    stage: null,
    category: null,
    industry: null,
    keywords: null,
    foundedYear: null,
    headcount: null,
    verticals: null,
    location: null,
    workType: null,
    sizeBand: null,
    latestRound: null,
    latestAmount: null,
    lastFundingDate: null,
    leadInvestor: null,
    fundingTotal: null,
    status: "new",
    source: null,
    sourceDetail: null,
    enrichmentBlob: null,
    deepDivePath: null,
    enrichmentCost: null,
    scoreFounderQuality: null,
    scoreInvestorQuality: null,
    scoreDomainFit: null,
    scoreStageFit: null,
    scoreSizeFit: null,
    scoreOverall: null,
    scoreRationale: null,
    scoreScoredBy: null,
    scoreVerdict: null,
    scoredAt: null,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  };
}

describe("prefilter — pure logic (rows → survivors)", () => {
  it("no criteria → everything survives", () => {
    const rows = [company({ id: 1 }), company({ id: 2 })];
    const { survivors, dropped } = prefilter(rows, {});
    expect(survivors).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("size-band encodes 'not too big' — drops large, keeps tiny/small/mid", () => {
    const criteria: PrefilterCriteria = { sizeBands: ["tiny", "small", "mid"] };
    const rows = [
      company({ id: 1, name: "Tiny", sizeBand: "tiny" }),
      company({ id: 2, name: "Mid", sizeBand: "mid" }),
      company({ id: 3, name: "Scaled", sizeBand: "large" }),
    ];
    const { survivors, dropped } = prefilter(rows, criteria);
    expect(survivors.map((c) => c.name)).toEqual(["Tiny", "Mid"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].axis).toBe("size_band");
  });

  it("stage / location / category / work_type each gate a row", () => {
    const criteria: PrefilterCriteria = {
      stages: ["seed", "series a"],
      locations: ["san francisco", "sf", "bay area"],
      categories: ["ai", "agents", "data"],
      workTypes: ["onsite", "hybrid"],
    };
    expect(prefilterOne(company({ stage: "Series A", location: "SF", category: "AI agents", workType: "hybrid" }), criteria).ok).toBe(true);
    expect(prefilterOne(company({ stage: "Series D" }), criteria)).toMatchObject({ ok: false, axis: "stage" });
    expect(prefilterOne(company({ location: "New York" }), criteria)).toMatchObject({ ok: false, axis: "location" });
    expect(prefilterOne(company({ category: "Biotech" }), criteria)).toMatchObject({ ok: false, axis: "category" });
    expect(prefilterOne(company({ workType: "remote" }), criteria)).toMatchObject({ ok: false, axis: "work_type" });
  });

  it("unknown (null) field on a constrained axis is NOT dropped (don't punish missing data)", () => {
    const criteria: PrefilterCriteria = { stages: ["seed"], sizeBands: ["tiny"] };
    // stage null, sizeBand null → survives
    expect(prefilterOne(company({ stage: null, sizeBand: null }), criteria).ok).toBe(true);
  });

  it("deal-breaker keywords drop a row before any other axis", () => {
    const criteria: PrefilterCriteria = { excludeKeywords: ["crypto"], sizeBands: ["tiny"] };
    const r = prefilterOne(company({ name: "CryptoThing", category: "AI", sizeBand: "large" }), criteria);
    expect(r).toMatchObject({ ok: false, axis: "exclude" });
  });

  it("matching is case-insensitive and substring-based for free-text axes", () => {
    const criteria: PrefilterCriteria = { categories: ["ai"] };
    expect(prefilterOne(company({ category: "Applied AI / Agents" }), criteria).ok).toBe(true);
  });
});
