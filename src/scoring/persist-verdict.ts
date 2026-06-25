/**
 * Persist an LLM **deep-review** verdict onto a company row (ADR-0003 §3).
 *
 * After `selectShortlist` picks the deep-review tier, the `score-companies`
 * skill — acting as the real LLM `Scorer` — reads `preferences.md` +
 * `narrative.md` + each company's enrichment and emits the 5 sub-scores (NULL
 * where there is no data) plus a structured `verdict` (thesis / concerns /
 * what-to-verify / confidence). `persistVerdict` writes that judgment through the
 * existing repo update path, tagged `scored_by = 'llm'`.
 *
 * It **recomputes** `score_overall` from the supplied sub-scores via
 * `combineOverall` (so the renormalize + co-dominant discount stay consistent
 * with the configured weights) rather than trusting a free-floating number.
 */
import type { CompanyRepo } from "../db/repository";
import type { Company } from "../db/schema";
import type { ScoreResult } from "./scorer";
import { combineOverall, DEFAULT_WEIGHTS, type ScoreWeights } from "./weights";

export interface PersistVerdictOptions {
  /** Weights used to recompute `overall` (defaults to founder/investor co-dominant). */
  weights?: ScoreWeights;
  /** Override the write timestamp (tests pin it). */
  now?: number;
}

/**
 * Write an LLM verdict for one company: the 5 sub-scores (`number | null`), a
 * recomputed `score_overall`, the one-line `score_rationale`, the structured
 * `score_verdict` (JSON-serialized), `score_scored_by = 'llm'`, and `scored_at`.
 *
 * Reuses `CompanyRepo.update` — the same persistence path the rubric run uses —
 * so there is no second write path to keep in sync. Returns the updated row (or
 * `undefined` if the id no longer exists).
 */
export function persistVerdict(
  repo: CompanyRepo,
  companyId: number,
  result: ScoreResult,
  opts: PersistVerdictOptions = {},
): Company | undefined {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const now = opts.now ?? Date.now();

  // Recompute overall from the LLM-supplied sub-scores so the renormalize +
  // co-dominant-coverage discount are applied consistently (never trust a
  // free-floating `result.overall`).
  const overall = combineOverall(result, weights);

  return repo.update(companyId, {
    scoreFounderQuality: result.founder_quality,
    scoreInvestorQuality: result.investor_quality,
    scoreDomainFit: result.domain_fit,
    scoreStageFit: result.stage_fit,
    scoreSizeFit: result.size_fit,
    scoreOverall: overall,
    scoreRationale: result.rationale,
    scoreScoredBy: "llm",
    scoreVerdict: result.verdict ? JSON.stringify(result.verdict) : null,
    scoredAt: now,
  });
}
