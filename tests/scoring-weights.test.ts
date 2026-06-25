import { describe, it, expect } from "vitest";
import {
  parseWeights,
  parsePrefilter,
  combineOverall,
  DEFAULT_WEIGHTS,
  type SubScores,
} from "../src/scoring";

describe("parseWeights — plain-language emphasis from preferences.md", () => {
  it("defaults are founder/investor co-dominant", () => {
    expect(DEFAULT_WEIGHTS.founder_quality).toBe(DEFAULT_WEIGHTS.investor_quality);
    expect(DEFAULT_WEIGHTS.founder_quality).toBeGreaterThan(DEFAULT_WEIGHTS.domain_fit);
  });

  it("reads qualitative high/medium/low", () => {
    const text = [
      "- founder_quality: high",
      "- investor_quality: high",
      "- domain_fit: medium",
      "- stage_fit: low",
      "- size_fit: medium",
    ].join("\n");
    const w = parseWeights(text);
    expect(w.founder_quality).toBe(w.investor_quality);
    expect(w.founder_quality).toBeGreaterThan(w.domain_fit);
    expect(w.stage_fit).toBeLessThan(w.domain_fit);
  });

  it("reads numeric weights and bolded markdown bullet forms", () => {
    const text = [
      "- **founder_quality** — 5",
      "- **investor_quality** — 4",
      "domain_fit: 2",
    ].join("\n");
    const w = parseWeights(text);
    expect(w.founder_quality).toBe(5);
    expect(w.investor_quality).toBe(4);
    expect(w.domain_fit).toBe(2);
    // unspecified axes keep the default
    expect(w.stage_fit).toBe(DEFAULT_WEIGHTS.stage_fit);
  });

  it("leaves defaults intact for an empty / malformed file (never throws)", () => {
    expect(parseWeights("")).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights("garbage with no axes")).toEqual(DEFAULT_WEIGHTS);
  });

  it("parses the scaffolded Emphasis section and keeps founder/investor co-dominant", () => {
    // Fixture of the scaffold's Emphasis block — NOT the live profile/preferences.md
    // (which is git-ignored personal data and absent on a fresh checkout).
    const text = [
      "### Emphasis (edit me)",
      "- founder_quality: high",
      "- investor_quality: high",
      "- domain_fit: medium",
      "- stage_fit: medium",
      "- size_fit: medium",
    ].join("\n");
    const w = parseWeights(text);
    expect(w.founder_quality).toBe(w.investor_quality);
    expect(w.founder_quality).toBeGreaterThan(w.domain_fit);
    expect(w.founder_quality).toBeGreaterThan(w.stage_fit);
    expect(w.founder_quality).toBeGreaterThan(w.size_fit);
  });
});

describe("combineOverall — weighted, normalized, clamped to [0,1]", () => {
  const perfect: SubScores = {
    founder_quality: 1,
    investor_quality: 1,
    domain_fit: 1,
    stage_fit: 1,
    size_fit: 1,
  };

  it("all-1 → 1 regardless of weight scale", () => {
    expect(combineOverall(perfect, DEFAULT_WEIGHTS)).toBe(1);
  });

  it("co-dominant axes move the overall more than secondary ones", () => {
    const highFounder: SubScores = { ...zero(), founder_quality: 1, investor_quality: 1 };
    const highSecondary: SubScores = { ...zero(), domain_fit: 1, stage_fit: 1, size_fit: 1 };
    expect(combineOverall(highFounder, DEFAULT_WEIGHTS)).toBeGreaterThan(
      combineOverall(highSecondary, DEFAULT_WEIGHTS),
    );
  });

  it("clamps out-of-range sub-scores", () => {
    expect(combineOverall({ ...perfect, founder_quality: 5 }, DEFAULT_WEIGHTS)).toBe(1);
  });

  it("renormalizes over present axes — a NULL axis neither helps nor hurts on its own", () => {
    // Drop a secondary axis (not co-dominant, so no confidence discount): the
    // weighted average is taken over the remaining present axes only. With all
    // present axes = 1, the renormalized base is still 1 (×1.0 coverage).
    const sub: SubScores = { ...perfect, size_fit: null };
    expect(combineOverall(sub, DEFAULT_WEIGHTS)).toBe(1);
  });

  it("does NOT treat a NULL axis as 0 (renormalize, don't fabricate)", () => {
    // founder/investor present (=1), domain present (=1), stage NULL, size present (=1).
    // If NULL were 0 the average would drop; renormalizing over present axes keeps it 1.
    const withNull: SubScores = { ...perfect, stage_fit: null };
    const asZero: SubScores = { ...perfect, stage_fit: 0 };
    expect(combineOverall(withNull, DEFAULT_WEIGHTS)).toBe(1);
    expect(combineOverall(asZero, DEFAULT_WEIGHTS)).toBeLessThan(1);
  });

  it("discounts for missing co-dominant coverage: both → ×0.6, one → ×0.8 vs all-present", () => {
    const allPresent = combineOverall(perfect, DEFAULT_WEIGHTS); // coverage 1.0
    const oneMissing = combineOverall({ ...perfect, founder_quality: null }, DEFAULT_WEIGHTS);
    const bothMissing = combineOverall(
      { ...perfect, founder_quality: null, investor_quality: null },
      DEFAULT_WEIGHTS,
    );
    // The base (weighted avg over present axes) is 1 in every case here, so the
    // ratio to all-present isolates the confidence factor exactly.
    expect(allPresent).toBe(1);
    expect(oneMissing).toBeCloseTo(0.8, 5); // one co-dominant missing → ×0.8
    expect(bothMissing).toBeCloseTo(0.6, 5); // both co-dominant missing → ×0.6
    expect(oneMissing).toBeLessThan(allPresent);
    expect(bothMissing).toBeLessThan(oneMissing);
  });

  it("all sub-scores NULL → 0 (nothing to evaluate)", () => {
    const none: SubScores = {
      founder_quality: null,
      investor_quality: null,
      domain_fit: null,
      stage_fit: null,
      size_fit: null,
    };
    expect(combineOverall(none, DEFAULT_WEIGHTS)).toBe(0);
  });
});

describe("parsePrefilter — hard criteria section", () => {
  it("reads stage / location+work-type / category / size band, splitting work types out", () => {
    const text = [
      "## Hard pre-filter criteria",
      "- **Stage:** pre-seed, seed, Series A",
      "- **Location / work type:** San Francisco, onsite, hybrid",
      "- **Category:** AI, agents, data",
      "- **Company size band:** tiny, small, mid",
    ].join("\n");
    const c = parsePrefilter(text);
    expect(c.stages).toEqual(["pre-seed", "seed", "series a"]);
    expect(c.locations).toContain("san francisco");
    expect(c.workTypes).toEqual(["onsite", "hybrid"]);
    expect(c.categories).toEqual(["ai", "agents", "data"]);
    expect(c.sizeBands).toEqual(["tiny", "small", "mid"]);
  });

  it("treats empty HTML-comment placeholders as 'no constraint'", () => {
    // Use the scaffold's placeholder shape directly — not the live
    // profile/preferences.md, which onboarding fills in (then this would fail).
    const text = [
      "## Hard pre-filter criteria",
      "",
      "- **Stage:** <!-- e.g. pre-seed, seed, Series A -->",
      "- **Location / work type:** <!-- e.g. SF Bay Area -->",
      "- **Category:** <!-- e.g. AI / agents / data infra -->",
      "- **Company size band:** <!-- e.g. < 200 people -->",
      "",
    ].join("\n");
    const c = parsePrefilter(text);
    // Comment-only placeholders → no hard constraints.
    expect(c.stages ?? []).toEqual([]);
    expect(c.categories ?? []).toEqual([]);
    expect(c.sizeBands ?? []).toEqual([]);
  });
});

function zero(): SubScores {
  return {
    founder_quality: 0,
    investor_quality: 0,
    domain_fit: 0,
    stage_fit: 0,
    size_fit: 0,
  };
}
