import { describe, it, expect, beforeEach } from "vitest";
import { createCompanyRepo, type CompanyRepo } from "../src/db/repository";
import { createTestDb } from "./helpers";
import {
  FakeScorer,
  scoreCompanies,
  sortByScore,
  DEFAULT_WEIGHTS,
  toScorePatch,
} from "../src/scoring";

describe("scoreCompanies — funnel with FakeScorer (offline, real Drizzle)", () => {
  let repo: CompanyRepo;
  beforeEach(async () => {
    repo = createCompanyRepo(await createTestDb());
  });

  it("pre-filters then persists sub-scores + overall + rationale + scored_at", async () => {
    const keep = await repo.create({ slug: "tiny", name: "Tiny Lab", sizeBand: "tiny" });
    const drop = await repo.create({ slug: "scaled", name: "Scaled Corp", sizeBand: "large" });

    const { scored, dropped } = await scoreCompanies(await repo.list(), {
      repo,
      scorer: new FakeScorer(),
      weights: DEFAULT_WEIGHTS,
      criteria: { sizeBands: ["tiny", "small", "mid"] },
    });

    expect(dropped.map((d) => d.company.id)).toEqual([drop.id]);
    expect(scored.map((s) => s.company.id)).toEqual([keep.id]);

    const reread = (await repo.get(keep.id))!;
    // This row has no founder/investor signal, so the co-dominant axes are NULL
    // (missing data, not fabricated). The secondary axes are always derivable.
    expect(reread.scoreFounderQuality).toBeNull();
    expect(reread.scoreInvestorQuality).toBeNull();
    expect(reread.scoreDomainFit).not.toBeNull();
    expect(reread.scoreStageFit).not.toBeNull();
    expect(reread.scoreSizeFit).not.toBeNull();
    expect(reread.scoreOverall).not.toBeNull();
    expect(typeof reread.scoreRationale).toBe("string");
    expect(reread.scoreRationale!.length).toBeGreaterThan(0);
    expect(reread.scoredAt).toBeGreaterThan(0);

    // The dropped company is left unscored.
    expect((await repo.get(drop.id))!.scoreOverall).toBeNull();
  });

  it("co-dominant weights make founder/investor dominate the overall", async () => {
    const c = await repo.create({ slug: "co", name: "Co" });
    // pin sub-scores: founder/investor high, secondary low
    const scorer = new FakeScorer({
      co: { founder_quality: 1, investor_quality: 1, domain_fit: 0, stage_fit: 0, size_fit: 0 },
    });
    const { scored } = await scoreCompanies([c], {
      repo,
      scorer,
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });
    // founder+investor carry weight 3+3 of 9 → overall = 6/9 ≈ 0.667
    expect(scored[0].result.overall).toBeGreaterThan(0.6);
  });

  it("toScorePatch maps the result onto the ADR-0001 score columns", () => {
    const patch = toScorePatch(
      {
        founder_quality: 0.8,
        investor_quality: 0.7,
        domain_fit: 0.6,
        stage_fit: 0.5,
        size_fit: 0.4,
        overall: 0.65,
        rationale: "why",
      },
      1234,
    );
    expect(patch).toMatchObject({
      scoreFounderQuality: 0.8,
      scoreInvestorQuality: 0.7,
      scoreOverall: 0.65,
      scoreRationale: "why",
      scoredAt: 1234,
    });
  });

  it("a NULL sub-score is persisted as NULL — missing data, never fabricated to 0", async () => {
    const c = await repo.create({ slug: "thin", name: "Thin" });
    // founder data missing → null; everything else present.
    const scorer = new FakeScorer({
      thin: { founder_quality: null, investor_quality: 0.6, domain_fit: 0.5, stage_fit: 0.5, size_fit: 0.5 },
    });
    const { scored } = await scoreCompanies([c], {
      repo,
      scorer,
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });

    // Preserved through the result...
    expect(scored[0].result.founder_quality).toBeNull();
    // ...and through persistence (NOT turned into 0).
    const reread = (await repo.get(c.id))!;
    expect(reread.scoreFounderQuality).toBeNull();
    expect(reread.scoreInvestorQuality).toBe(0.6);
    // overall is still computed (renormalized + co-dominant discount), never null here.
    expect(reread.scoreOverall).not.toBeNull();
    expect(reread.scoreOverall!).toBeGreaterThan(0);
  });

  it("FakeScorer returns NULL co-dominant axes when the row carries no founder/investor signal", async () => {
    const c = await repo.create({ slug: "bare", name: "Bare" }); // no enrichment, no leadInvestor
    const { scored } = await scoreCompanies([c], {
      repo,
      scorer: new FakeScorer(),
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });
    expect(scored[0].result.founder_quality).toBeNull();
    expect(scored[0].result.investor_quality).toBeNull();
    // secondary axes are still derived (present)
    expect(scored[0].result.domain_fit).not.toBeNull();
  });

  it("scoredBy provenance defaults to 'rubric' and persists", async () => {
    const c = await repo.create({ slug: "prov", name: "Prov" });
    const { scored } = await scoreCompanies([c], {
      repo,
      scorer: new FakeScorer(),
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });
    expect(scored[0].result.scoredBy).toBe("rubric");
    expect((await repo.get(c.id))!.scoreScoredBy).toBe("rubric");
  });

  it("toScorePatch defaults scoredBy to 'rubric' and serializes an llm verdict", () => {
    const rubric = toScorePatch({
      founder_quality: 0.5,
      investor_quality: 0.5,
      domain_fit: 0.5,
      stage_fit: 0.5,
      size_fit: 0.5,
      overall: 0.5,
      rationale: "r",
    });
    expect(rubric.scoreScoredBy).toBe("rubric");
    expect(rubric.scoreVerdict).toBeNull();

    const llm = toScorePatch({
      founder_quality: 0.5,
      investor_quality: 0.5,
      domain_fit: 0.5,
      stage_fit: 0.5,
      size_fit: 0.5,
      overall: 0.5,
      rationale: "r",
      scoredBy: "llm",
      verdict: { thesis: "strong team", concerns: ["thin moat"], confidence: 0.7 },
    });
    expect(llm.scoreScoredBy).toBe("llm");
    expect(JSON.parse(llm.scoreVerdict!)).toMatchObject({ thesis: "strong team", confidence: 0.7 });
  });
});

describe("sortByScore — any axis, nulls last", () => {
  let repo: CompanyRepo;
  beforeEach(async () => {
    repo = createCompanyRepo(await createTestDb());
  });

  it("sorts by overall desc by default, unscored rows last", async () => {
    const a = await repo.create({ slug: "a", name: "A" });
    const b = await repo.create({ slug: "b", name: "B" });
    const c = await repo.create({ slug: "c", name: "C" }); // never scored

    await scoreCompanies([a, b], {
      repo,
      scorer: new FakeScorer({
        a: { founder_quality: 0.2, investor_quality: 0.2, domain_fit: 0.2, stage_fit: 0.2, size_fit: 0.2 },
        b: { founder_quality: 0.9, investor_quality: 0.9, domain_fit: 0.9, stage_fit: 0.9, size_fit: 0.9 },
      }),
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });

    const ranked = sortByScore(await repo.list(), "overall", "desc");
    expect(ranked.map((x) => x.slug)).toEqual(["b", "a", "c"]);
    void c;
  });

  it("can sort by a single axis (founder_quality)", async () => {
    const a = await repo.create({ slug: "a", name: "A" });
    const b = await repo.create({ slug: "b", name: "B" });
    await scoreCompanies([a, b], {
      repo,
      scorer: new FakeScorer({
        a: { founder_quality: 0.9, investor_quality: 0.1, domain_fit: 0.1, stage_fit: 0.1, size_fit: 0.1 },
        b: { founder_quality: 0.1, investor_quality: 0.9, domain_fit: 0.9, stage_fit: 0.9, size_fit: 0.9 },
      }),
      weights: DEFAULT_WEIGHTS,
      criteria: {},
    });
    const byFounder = sortByScore(await repo.list(), "founder_quality", "desc");
    expect(byFounder[0].slug).toBe("a");
    const byInvestor = sortByScore(await repo.list(), "investor_quality", "desc");
    expect(byInvestor[0].slug).toBe("b");
  });
});
