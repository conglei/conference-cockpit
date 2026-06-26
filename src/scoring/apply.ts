/**
 * Persist taste scores the **agent** judged (the `score-companies` skill).
 *
 * The split (ADR-0002 / ADR-0005): the agent does ALL the judgment — it reads
 * `preferences.md` + the company/founder/funding signal and decides the five
 * sub-scores + a one-line rationale (+ optional verdict). This module is the thin,
 * deterministic persistence seam it pipes that judgment through: it computes the
 * `overall` from the user's weights (so weighting stays consistent and is not the
 * agent's job) and writes the row via the existing `toScorePatch` → `CompanyRepo`.
 *
 * No per-axis CLI flags, no bespoke write surface — one JSON shape in, scores out.
 */
import type { CompanyRepo } from "../db/repository";
import type { SubScores, ScoreVerdict, ScoreResult } from "./scorer";
import { combineOverall, type ScoreWeights } from "./weights";
import { toScorePatch } from "./score-run";

/** One company's agent-judged score. Axes are 0–1, or null/omitted for "no data". */
export interface AppliedScoreInput {
  slug: string;
  founder_quality?: number | null;
  investor_quality?: number | null;
  domain_fit?: number | null;
  stage_fit?: number | null;
  size_fit?: number | null;
  rationale: string;
  verdict?: ScoreVerdict;
}

export interface ApplyScoresResult {
  applied: { slug: string; overall: number }[];
  notFound: string[];
}

/** A finite number passes through (combineOverall clamps); anything else → null. */
function axis(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Turn one agent-judged input into a full `ScoreResult`: the agent owns the
 * sub-scores + rationale (+ verdict); we compute `overall` from the weights and
 * stamp provenance as `llm` (this is the deep-review judgment, not the rubric).
 */
export function buildScoreResult(input: AppliedScoreInput, weights: ScoreWeights): ScoreResult {
  const sub: SubScores = {
    founder_quality: axis(input.founder_quality),
    investor_quality: axis(input.investor_quality),
    domain_fit: axis(input.domain_fit),
    stage_fit: axis(input.stage_fit),
    size_fit: axis(input.size_fit),
  };
  return {
    ...sub,
    overall: combineOverall(sub, weights),
    rationale: input.rationale,
    scoredBy: "llm",
    verdict: input.verdict,
  };
}

/**
 * Persist each judged score onto its company row (by slug). Unknown slugs are
 * collected and reported rather than throwing, so a batch with one typo still
 * lands the rest.
 */
export async function applyScores(
  repo: CompanyRepo,
  items: AppliedScoreInput[],
  weights: ScoreWeights,
  now: number = Date.now(),
): Promise<ApplyScoresResult> {
  const applied: { slug: string; overall: number }[] = [];
  const notFound: string[] = [];
  for (const item of items) {
    const company = await repo.getBySlug(item.slug);
    if (!company) {
      notFound.push(item.slug);
      continue;
    }
    const result = buildScoreResult(item, weights);
    await repo.update(company.id, toScorePatch(result, now));
    applied.push({ slug: item.slug, overall: result.overall });
  }
  return { applied, notFound };
}
