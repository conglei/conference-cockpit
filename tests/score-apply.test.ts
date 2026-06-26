import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { applyScores, buildScoreResult, DEFAULT_WEIGHTS } from "../src/scoring";

describe("buildScoreResult (agent judgment → ScoreResult)", () => {
  it("computes overall from weights, stamps llm provenance, keeps the verdict", () => {
    const r = buildScoreResult(
      {
        slug: "acme",
        founder_quality: 0.8,
        investor_quality: 0.7,
        domain_fit: 0.6,
        stage_fit: 0.5,
        size_fit: 0.9,
        rationale: "elite founders",
        verdict: { thesis: "strong", confidence: 0.8 },
      },
      DEFAULT_WEIGHTS,
    );
    expect(r.overall).toBeGreaterThan(0);
    expect(r.overall).toBeLessThanOrEqual(1);
    expect(r.scoredBy).toBe("llm");
    expect(r.rationale).toBe("elite founders");
    expect(r.verdict?.thesis).toBe("strong");
  });

  it("treats omitted/null/invalid axes as null (no fabricated 0)", () => {
    const r = buildScoreResult(
      { slug: "x", founder_quality: 0.8, investor_quality: null, rationale: "partial" },
      DEFAULT_WEIGHTS,
    );
    expect(r.founder_quality).toBe(0.8);
    expect(r.investor_quality).toBeNull();
    expect(r.domain_fit).toBeNull(); // omitted
  });
});

describe("applyScores (persist agent-judged scores)", () => {
  let db: DB;

  beforeEach(async () => {
    db = await createTestDb();
    const companies = createCompanyRepo(db);
    await companies.create({ slug: "acme", name: "Acme", status: "new" });
    await companies.create({ slug: "other", name: "Other", status: "new" });
  });

  it("writes the score columns onto the company row, by slug", async () => {
    const repo = createCompanyRepo(db);
    const { applied, notFound } = await applyScores(
      repo,
      [
        {
          slug: "acme",
          founder_quality: 0.9,
          investor_quality: 0.8,
          domain_fit: 0.6,
          stage_fit: 0.5,
          size_fit: 0.7,
          rationale: "elite founders + strong cap table",
        },
      ],
      DEFAULT_WEIGHTS,
      1_000,
    );

    expect(notFound).toEqual([]);
    expect(applied).toHaveLength(1);

    const acme = await repo.getBySlug("acme");
    expect(acme?.scoreOverall).toBe(applied[0].overall);
    expect(acme?.scoreFounderQuality).toBe(0.9);
    expect(acme?.scoreRationale).toBe("elite founders + strong cap table");
    expect(acme?.scoreScoredBy).toBe("llm");
    expect(acme?.scoredAt).toBe(1_000);
  });

  it("persists a null axis as NULL, not a number", async () => {
    const repo = createCompanyRepo(db);
    await applyScores(
      repo,
      [{ slug: "acme", founder_quality: 0.9, investor_quality: null, rationale: "no investor data" }],
      DEFAULT_WEIGHTS,
    );
    const acme = await repo.getBySlug("acme");
    expect(acme?.scoreFounderQuality).toBe(0.9);
    expect(acme?.scoreInvestorQuality).toBeNull();
  });

  it("reports unknown slugs without throwing, still applying the rest", async () => {
    const repo = createCompanyRepo(db);
    const { applied, notFound } = await applyScores(
      repo,
      [
        { slug: "acme", founder_quality: 0.5, rationale: "ok" },
        { slug: "ghost", founder_quality: 0.5, rationale: "nope" },
      ],
      DEFAULT_WEIGHTS,
    );
    expect(applied.map((a) => a.slug)).toEqual(["acme"]);
    expect(notFound).toEqual(["ghost"]);
  });
});
