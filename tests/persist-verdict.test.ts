import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";
import { persistVerdict, combineOverall, DEFAULT_WEIGHTS } from "../src/scoring";
import type { ScoreResult } from "../src/scoring";

describe("persistVerdict — LLM deep-review persistence (scored_by 'llm')", () => {
  let repo: CompanyRepo;
  beforeEach(() => {
    repo = createCompanyRepo(createTestDb());
  });

  it("writes sub-scores, scoredBy 'llm', serialized verdict, and recomputed overall", () => {
    const c = repo.create({ slug: "deep", name: "Deep Co" });

    const result: ScoreResult = {
      founder_quality: 0.9,
      investor_quality: 0.8,
      domain_fit: 0.7,
      stage_fit: 0.6,
      size_fit: 0.5,
      overall: 0.123, // deliberately wrong — must be recomputed, not trusted
      rationale: "strong founders, tier-1 lead",
      verdict: {
        thesis: "elite team in agents",
        concerns: ["crowded space"],
        whatToVerify: ["confirm lead investor"],
        confidence: 0.8,
      },
    };

    const updated = persistVerdict(repo, c.id, result, { now: 4242 });
    expect(updated).toBeDefined();

    const reread = repo.get(c.id)!;
    expect(reread.scoreScoredBy).toBe("llm");
    expect(reread.scoreFounderQuality).toBe(0.9);
    expect(reread.scoreInvestorQuality).toBe(0.8);
    expect(reread.scoreDomainFit).toBe(0.7);
    expect(reread.scoreStageFit).toBe(0.6);
    expect(reread.scoreSizeFit).toBe(0.5);
    expect(reread.scoreRationale).toBe("strong founders, tier-1 lead");
    expect(reread.scoredAt).toBe(4242);

    // overall is RECOMPUTED via combineOverall, not the bogus 0.123.
    const expected = combineOverall(result, DEFAULT_WEIGHTS);
    expect(reread.scoreOverall).toBe(expected);
    expect(reread.scoreOverall).not.toBe(0.123);

    // verdict is stored as JSON.
    const verdict = JSON.parse(reread.scoreVerdict!);
    expect(verdict).toMatchObject({
      thesis: "elite team in agents",
      concerns: ["crowded space"],
      confidence: 0.8,
    });
  });

  it("recompute honors NULL sub-scores (renormalize + co-dominant discount)", () => {
    const c = repo.create({ slug: "thin", name: "Thin" });

    // No founder data → NULL. Recomputed overall must apply the one-missing
    // co-dominant discount, not fabricate a 0 for founder_quality.
    const result: ScoreResult = {
      founder_quality: null,
      investor_quality: 0.6,
      domain_fit: 0.5,
      stage_fit: 0.5,
      size_fit: 0.5,
      overall: 0,
      rationale: "⚠ no founder data; solid lead investor",
      scoredBy: "llm",
    };

    persistVerdict(repo, c.id, result);
    const reread = repo.get(c.id)!;
    expect(reread.scoreFounderQuality).toBeNull();
    expect(reread.scoreInvestorQuality).toBe(0.6);
    expect(reread.scoreOverall).toBe(combineOverall(result, DEFAULT_WEIGHTS));
    expect(reread.scoreOverall!).toBeGreaterThan(0);
    expect(reread.scoreVerdict).toBeNull(); // no verdict supplied
  });

  it("respects custom weights when recomputing overall", () => {
    const c = repo.create({ slug: "w", name: "W" });
    const result: ScoreResult = {
      founder_quality: 1,
      investor_quality: 0,
      domain_fit: 0,
      stage_fit: 0,
      size_fit: 0,
      overall: 0,
      rationale: "r",
    };
    const weights = { ...DEFAULT_WEIGHTS, founder_quality: 10 };
    persistVerdict(repo, c.id, result, { weights });
    expect(repo.get(c.id)!.scoreOverall).toBe(combineOverall(result, weights));
  });

  it("returns undefined for a missing company id", () => {
    const result: ScoreResult = {
      founder_quality: 0.5,
      investor_quality: 0.5,
      domain_fit: 0.5,
      stage_fit: 0.5,
      size_fit: 0.5,
      overall: 0.5,
      rationale: "r",
    };
    expect(persistVerdict(repo, 9999, result)).toBeUndefined();
  });
});
