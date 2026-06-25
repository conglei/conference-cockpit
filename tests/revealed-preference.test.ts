import { describe, it, expect } from "vitest";
import { revealedPreference } from "../src/feedback/revealed-preference";
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

describe("revealedPreference — mine the funnel's kept vs passed", () => {
  // A small mixed funnel: 3 kept (one of each kept status), 2 passed, plus
  // new/enriched rows that should be ignored entirely.
  const companies: Company[] = [
    company({ slug: "agentco", status: "interesting", category: "AI Agents", stage: "Seed", scoreOverall: 0.8 }),
    company({ slug: "dataco", status: "watching", category: "Data", stage: "Seed" }),
    company({ slug: "infraco", status: "pursuing", category: "AI Agents", stage: "Series A" }),
    company({ slug: "secone", status: "passed", category: "Cybersecurity", stage: "Series A", scoreOverall: 0.7 }),
    company({ slug: "sectwo", status: "passed", category: "Cybersecurity", stage: "Seed" }),
    company({ slug: "freshco", status: "new", category: "AI Agents", stage: "Seed" }),
    company({ slug: "enrichedco", status: "enriched", category: "Data", stage: "Seed" }),
  ];

  const rp = revealedPreference(companies);

  it("partitions kept (interesting/watching/pursuing) from passed, ignoring new/enriched", () => {
    expect(rp.kept.map((s) => s.slug).sort()).toEqual(["agentco", "dataco", "infraco"]);
    expect(rp.passed.map((s) => s.slug).sort()).toEqual(["secone", "sectwo"]);
    expect(rp.summary.keptCount).toBe(3);
    expect(rp.summary.passedCount).toBe(2);
  });

  it("projects each row to a compact CompanySignal", () => {
    const agent = rp.kept.find((s) => s.slug === "agentco")!;
    expect(agent).toEqual({
      slug: "agentco",
      name: "Co",
      category: "AI Agents",
      stage: "Seed",
      sizeBand: null,
      leadInvestor: null,
      scoreOverall: 0.8,
    });
  });

  it("tallies category frequencies for kept vs passed (the visible contrast)", () => {
    // Kept skews AI Agents; passed is entirely Cybersecurity — the gap the skill mines.
    expect(rp.summary.keptCategories).toEqual({ "ai agents": 2, data: 1 });
    expect(rp.summary.passedCategories).toEqual({ cybersecurity: 2 });
  });

  it("tallies stage frequencies for kept vs passed", () => {
    expect(rp.summary.keptStages).toEqual({ seed: 2, "series a": 1 });
    expect(rp.summary.passedStages).toEqual({ "series a": 1, seed: 1 });
  });

  it("normalizes labels case-insensitively and skips null/blank fields", () => {
    const rp2 = revealedPreference([
      company({ slug: "a", status: "interesting", category: "Cybersecurity" }),
      company({ slug: "b", status: "interesting", category: "cybersecurity" }),
      company({ slug: "c", status: "interesting", category: null, stage: "  " }),
    ]);
    expect(rp2.summary.keptCategories).toEqual({ cybersecurity: 2 });
    expect(rp2.summary.keptStages).toEqual({}); // null + blank → no buckets
  });

  it("empty funnel → empty partitions and tallies", () => {
    const rp3 = revealedPreference([]);
    expect(rp3.kept).toEqual([]);
    expect(rp3.passed).toEqual([]);
    expect(rp3.summary).toEqual({
      keptCount: 0,
      passedCount: 0,
      keptCategories: {},
      passedCategories: {},
      keptStages: {},
      passedStages: {},
    });
  });
});
