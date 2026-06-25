/**
 * Pure sorting over the company score axes — shared by the UI (`src/app/page.tsx`)
 * and tests. Nulls (unscored companies) sort last regardless of direction.
 */
import type { Company } from "../db/schema";

/** The score axes a user can sort by. */
export const SCORE_AXES = [
  "overall",
  "founder_quality",
  "investor_quality",
  "domain_fit",
  "stage_fit",
  "size_fit",
] as const;

export type ScoreAxis = (typeof SCORE_AXES)[number];

export function isScoreAxis(v: string | undefined): v is ScoreAxis {
  return !!v && (SCORE_AXES as readonly string[]).includes(v);
}

const COLUMN: Record<ScoreAxis, (c: Company) => number | null> = {
  overall: (c) => c.scoreOverall,
  founder_quality: (c) => c.scoreFounderQuality,
  investor_quality: (c) => c.scoreInvestorQuality,
  domain_fit: (c) => c.scoreDomainFit,
  stage_fit: (c) => c.scoreStageFit,
  size_fit: (c) => c.scoreSizeFit,
};

/** Read a single axis off a company row. */
export function scoreValue(c: Company, axis: ScoreAxis): number | null {
  return COLUMN[axis](c);
}

/**
 * Sort a copy of `companies` by the given axis. `dir` defaults to "desc" (best
 * first). Unscored rows (null on that axis) always sort to the end. Stable on
 * ties via name then id.
 */
export function sortByScore(
  companies: Company[],
  axis: ScoreAxis,
  dir: "asc" | "desc" = "desc",
): Company[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...companies].sort((a, b) => {
    const va = scoreValue(a, axis);
    const vb = scoreValue(b, axis);
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1; // a unscored → after b
    if (vb === null) return -1;
    if (va !== vb) return sign * (va - vb);
    return tieBreak(a, b);
  });
}

function tieBreak(a: Company, b: Company): number {
  return a.name.localeCompare(b.name) || a.id - b.id;
}
