/**
 * The deterministic funnel that wires Stage 1 (pre-filter) → Stage 2 (Scorer) →
 * persistence. This is a primitive the `score-companies` skill calls; the skill
 * supplies the real (LLM) `Scorer`, while tests/dry-runs supply `FakeScorer`.
 *
 * Persistence goes through the existing typed data layer (`CompanyRepo.update`) —
 * we do NOT touch `src/db/repository.ts` (issue 08 edits it in parallel). The
 * sub-scores + overall + one-line rationale + `scored_at` are written onto the
 * company row, exactly the score columns ADR-0001 already provisioned.
 */
import type { CompanyRepo } from "../db/repository";
import type { Company } from "../db/schema";
import { prefilter, type PrefilterCriteria, type PrefilterDrop } from "./prefilter";
import type { Scorer, ScoreResult } from "./scorer";
import type { ScoreWeights } from "./weights";

/** One company's scoring outcome. */
export interface ScoredCompany {
  company: Company;
  result: ScoreResult;
}

export interface ScoreRunResult {
  scored: ScoredCompany[];
  dropped: PrefilterDrop[];
}

export interface ScoreRunDeps {
  repo: CompanyRepo;
  scorer: Scorer;
  weights: ScoreWeights;
  criteria: PrefilterCriteria;
  /** Verbatim preferences/narrative text handed to the (real) scorer. Optional. */
  preferences?: string;
  narrative?: string;
}

/**
 * Translate a `ScoreResult` into the company score columns (ADR-0001 + ADR-0003 §3).
 *
 * Sub-scores pass through as `number | null` — a missing-data axis persists as
 * NULL, never a fabricated 0. Provenance defaults to `rubric`; the structured LLM
 * `verdict` is serialized to the `score_verdict` blob (NULL when absent).
 */
export function toScorePatch(result: ScoreResult, now: number = Date.now()) {
  return {
    scoreFounderQuality: result.founder_quality,
    scoreInvestorQuality: result.investor_quality,
    scoreDomainFit: result.domain_fit,
    scoreStageFit: result.stage_fit,
    scoreSizeFit: result.size_fit,
    scoreOverall: result.overall,
    scoreRationale: result.rationale,
    scoreScoredBy: result.scoredBy ?? "rubric",
    scoreVerdict: result.verdict ? JSON.stringify(result.verdict) : null,
    scoredAt: now,
  };
}

/**
 * Pre-filter the given companies, score the survivors with the injected
 * `Scorer`, and persist sub-scores + overall + rationale + scored_at onto each
 * survivor's row. Returns the scored set and the dropped set (with reasons).
 */
export async function scoreCompanies(
  companies: Company[],
  deps: ScoreRunDeps,
): Promise<ScoreRunResult> {
  const { survivors, dropped } = prefilter(companies, deps.criteria);

  const scored: ScoredCompany[] = [];
  for (const company of survivors) {
    const result = await deps.scorer.score(
      { company, preferences: deps.preferences, narrative: deps.narrative },
      deps.weights,
    );
    const updated = deps.repo.update(company.id, toScorePatch(result));
    scored.push({ company: updated ?? company, result });
  }

  return { scored, dropped };
}
