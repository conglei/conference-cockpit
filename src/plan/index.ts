/**
 * The conference plan engine (product-design.md §11 Phase 2).
 * Public surface: build a goal-ranked, company-first plan over the enriched
 * graph through a pluggable lens (Career Mover is the populated MVP lens).
 */
export * from "./types";
export { buildPlan, loadGraph, graphHasScores, DEFAULT_PLAN_LIMIT } from "./plan";
export { loadGoalProfile } from "./profile";
export { careerMoverLens } from "./career-mover";

import type { Lens } from "./types";
import { careerMoverLens } from "./career-mover";

/** Registry of available lenses — the seam where a second lens drops in. */
export const LENSES: Record<string, Lens> = {
  [careerMoverLens.key]: careerMoverLens,
};

export function getLens(key: string): Lens | undefined {
  return LENSES[key];
}
