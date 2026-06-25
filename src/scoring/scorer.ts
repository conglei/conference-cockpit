/**
 * Stage 2 of the hybrid scorer — the `Scorer` **interface** plus an offline
 * `FakeScorer`.
 *
 * ADR-0002 boundary: the REAL scorer is **LLM-driven judgment** and therefore
 * lives in the `score-companies` **skill** (`.claude/skills/score-companies/SKILL.md`),
 * NOT in a CLI. The skill reads `preferences.md` + `narrative.md` + the company
 * and **founder** enrichment, reasons about taste, and emits the sub-scores +
 * one-line rationale. This file only defines:
 *
 *   1. the `Scorer` **interface** — the seam the skill writes through and the
 *      CLI/tests inject; and
 *   2. a deterministic `FakeScorer` — so the funnel/persistence/sorting code is
 *      testable offline with zero model calls (PRD "Second seam — Scorer interface").
 *
 * Sub-scores are on a 0–1 scale. `founder_quality` and `investor_quality` are
 * **co-dominant** (highest weight); the weights themselves come from
 * `preferences.md` (see `./weights.ts`) so taste is tunable without code changes.
 */
import type { Company } from "../db/schema";
import type { ScoreWeights } from "./weights";
import { combineOverall } from "./weights";

/**
 * The five taste sub-scores, each 0–1 **or `null`**.
 *
 * `null` means **missing data** — the axis is genuinely unknown, e.g. no founder
 * data to judge `founder_quality` (ADR-0003 §3: "A sub-score with no underlying
 * data is NULL, not a number"). It is never a fabricated 0. `combineOverall`
 * renormalizes over the present (non-null) axes and discounts for missing
 * co-dominant coverage, so a `null` is treated as "unknown", not "bad".
 */
export interface SubScores {
  founder_quality: number | null;
  investor_quality: number | null;
  domain_fit: number | null;
  stage_fit: number | null;
  size_fit: number | null;
}

/** Who produced a score row — deterministic rubric triage vs. LLM deep-review (ADR-0003 §3). */
export type ScoredBy = "rubric" | "llm";

/**
 * The LLM deep-review verdict (ADR-0003 §3): thesis, concerns/risks, what to
 * verify before outreach, and a confidence. Persisted verbatim as a JSON/markdown
 * blob in `score_verdict`; only the `llm` scorer fills it, so it is optional.
 */
export interface ScoreVerdict {
  thesis?: string;
  concerns?: string[];
  whatToVerify?: string[];
  confidence?: number;
  [k: string]: unknown;
}

/** A full taste-score result: sub-scores + overall + a stored one-line rationale. */
export interface ScoreResult extends SubScores {
  /** Weighted average over the present axes, discounted for missing co-dominant coverage. 0–1. */
  overall: number;
  /** One-line, human-readable "why this surfaced" — persisted to score_rationale. */
  rationale: string;
  /** Provenance: `rubric` (cheap triage) or `llm` (deep-review). Defaults to `rubric`. */
  scoredBy?: ScoredBy;
  /** Optional structured LLM verdict (thesis / concerns / what-to-verify / confidence). */
  verdict?: ScoreVerdict;
}

/**
 * What the scorer reads: the company row (incl. its `enrichment_blob`), plus the
 * narrative/preferences text the skill passes through. The real (skill) scorer
 * leans hardest on the founder + lead-investor signal inside the enrichment.
 */
export interface ScoreContext {
  company: Company;
  /** Plain-language preferences.md contents (taste & weights). Optional for fakes. */
  preferences?: string;
  /** Plain-language narrative.md contents (the user's story). Optional for fakes. */
  narrative?: string;
}

/**
 * The Scorer seam. The real implementation is the LLM skill; `FakeScorer` is the
 * deterministic test double. `weights` are parsed from `preferences.md`.
 */
export interface Scorer {
  readonly name: string;
  score(ctx: ScoreContext, weights: ScoreWeights): Promise<ScoreResult>;
}

/**
 * Deterministic, offline scorer for tests and dry-runs. It does NOT make taste
 * judgments (that is the skill's job) — it derives stable sub-scores from
 * whatever structured signal exists on the row, then combines them with the
 * configured weights so the funnel/persistence/sorting can be exercised end to
 * end without a model.
 *
 * Per-company sub-scores can be pinned via the `fixtures` map (keyed by slug) so
 * tests assert exact numbers; anything unpinned is synthesized deterministically.
 */
export class FakeScorer implements Scorer {
  readonly name = "fake";
  constructor(private readonly fixtures: Record<string, Partial<SubScores>> = {}) {}

  async score(ctx: ScoreContext, weights: ScoreWeights): Promise<ScoreResult> {
    const { company } = ctx;
    const pinned = this.fixtures[company.slug] ?? {};

    // A pinned axis may be `null` to model missing data; only fall back to a
    // derived value when the slug was not pinned for that axis at all. Use
    // `hasOwnProperty` so a pinned `null` is preserved (not turned into a guess).
    const sub: SubScores = {
      founder_quality: pick(pinned, "founder_quality", () => deriveFounderQuality(company)),
      investor_quality: pick(pinned, "investor_quality", () => deriveInvestorQuality(company)),
      domain_fit: pick(pinned, "domain_fit", () => deriveDomainFit(company)),
      stage_fit: pick(pinned, "stage_fit", () => deriveStageFit(company)),
      size_fit: pick(pinned, "size_fit", () => deriveSizeFit(company)),
    };

    const overall = combineOverall(sub, weights);
    const rationale = buildRationale(company, sub, weights);
    // FakeScorer is the deterministic rubric double, never the LLM deep-review.
    return { ...sub, overall, rationale, scoredBy: "rubric" };
  }
}

/** Stable hash of a string → [0,1). Keeps FakeScorer deterministic per company. */
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // map to [0,1)
  return ((h >>> 0) % 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve one sub-score: a pinned fixture value (including an explicit `null`,
 * which models missing data and must be preserved) wins; otherwise derive.
 */
function pick(
  pinned: Partial<SubScores>,
  axis: keyof SubScores,
  derive: () => number | null,
): number | null {
  return Object.prototype.hasOwnProperty.call(pinned, axis) ? pinned[axis]! ?? null : derive();
}

// The fake leans on whatever real signal is on the row. Co-dominant axes return
// **null** (missing data) when the row carries no founder / investor signal —
// the fake refuses to fabricate a co-dominant judgment out of nothing (ADR-0003 §3).
function deriveFounderQuality(c: Company): number | null {
  const blob = readBlob(c);
  const founders = blob?.founders;
  if (Array.isArray(founders) && founders.length > 0) {
    // crude: presence of a seniority/title signal nudges up
    const senior = founders.some(
      (f: { title?: string }) => /ceo|cto|chief|founder|president/i.test(f?.title ?? ""),
    );
    return round2(senior ? 0.8 : 0.6);
  }
  return null; // no founder data → unknown, not a guess
}

function deriveInvestorQuality(c: Company): number | null {
  if (c.leadInvestor && c.leadInvestor.trim() !== "") {
    return round2(0.7 + unit("inv:" + c.leadInvestor) * 0.3);
  }
  return null; // no investor data → unknown, not a guess
}

function deriveDomainFit(c: Company): number {
  return round2(0.4 + unit("dom:" + (c.category ?? c.slug)) * 0.5);
}

function deriveStageFit(c: Company): number {
  return round2(0.4 + unit("stage:" + (c.stage ?? c.slug)) * 0.5);
}

function deriveSizeFit(c: Company): number {
  // smaller is better in this cockpit ("not too big")
  const band = (c.sizeBand ?? "").toLowerCase();
  const map: Record<string, number> = { tiny: 0.95, small: 0.85, mid: 0.6, large: 0.3 };
  if (band in map) return map[band];
  return round2(0.4 + unit("size:" + c.slug) * 0.4);
}

function buildRationale(c: Company, sub: SubScores, weights: ScoreWeights): string {
  // Lead with the co-dominant axes (highest-weighted), per the user's taste.
  // A NULL axis (missing data) reads as a "⚠ no … data" flag, never a number.
  const ordered = (Object.keys(sub) as (keyof SubScores)[])
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
    .slice(0, 2)
    .map((k) => {
      const v = sub[k];
      const label = k.replace(/_/g, " ");
      return v === null ? `⚠ no ${label} data` : `${label} ${Math.round(v * 100)}`;
    });
  return `${c.name}: ${ordered.join(", ")} (fake scorer)`;
}

interface EnrichmentBlob {
  founders?: { name?: string; title?: string }[];
  [k: string]: unknown;
}

function readBlob(c: Company): EnrichmentBlob | undefined {
  if (!c.enrichmentBlob) return undefined;
  try {
    return JSON.parse(c.enrichmentBlob) as EnrichmentBlob;
  } catch {
    return undefined;
  }
}
