/**
 * Feedback loop, step 1 — mine the funnel's **revealed preference** (ADR-0003 §3).
 *
 * The funnel already records what the user *did*: companies they kept
 * (`interesting` / `watching` / `pursuing`) versus ones they explicitly
 * `passed`. Stated taste (`preferences.md`) and revealed taste drift apart — the
 * user keeps passing high-scoring AI-cybersecurity, say — and that gap is exactly
 * what the `refine-taste` skill proposes edits for.
 *
 * This module is the **deterministic primitive** (ADR-0002): it projects company
 * rows into compact signals and tallies category/stage frequencies for kept vs.
 * passed so the contrast is *visible* to the LLM. It does NOT make the judgment
 * (that's the skill, reading this summary) and it does NOT touch the DB — it's a
 * pure `Company[] → RevealedPreference` function so it's trivially testable.
 */
import type { Company, CompanyStatus } from "../db/schema";

/** Statuses that count as "kept" — the user found these worth pursuing/watching. */
const KEPT_STATUSES: readonly CompanyStatus[] = ["interesting", "watching", "pursuing"];
/** Status that counts as "passed" — the user explicitly rejected these. */
const PASSED_STATUS: CompanyStatus = "passed";

/**
 * A compact projection of a company — just the signals the contrast cares about,
 * so the revealed-preference summary stays small and the skill reads it at a
 * glance.
 */
export interface CompanySignal {
  slug: string;
  name: string;
  category: string | null;
  stage: string | null;
  sizeBand: string | null;
  leadInvestor: string | null;
  scoreOverall: number | null;
}

/** A frequency table: lower-cased label → count. */
export type Tally = Record<string, number>;

export interface RevealedPreference {
  /** Companies the user kept (status interesting / watching / pursuing). */
  kept: CompanySignal[];
  /** Companies the user explicitly passed. */
  passed: CompanySignal[];
  summary: {
    keptCount: number;
    passedCount: number;
    /** Category frequency among kept companies (lower-cased label → count). */
    keptCategories: Tally;
    /** Category frequency among passed companies. */
    passedCategories: Tally;
    /** Stage frequency among kept companies. */
    keptStages: Tally;
    /** Stage frequency among passed companies. */
    passedStages: Tally;
  };
}

function toSignal(c: Company): CompanySignal {
  return {
    slug: c.slug,
    name: c.name,
    category: c.category,
    stage: c.stage,
    sizeBand: c.sizeBand,
    leadInvestor: c.leadInvestor,
    scoreOverall: c.scoreOverall,
  };
}

/** Tally a field across signals, skipping null/blank values, keyed by a normalized label. */
function tally(signals: CompanySignal[], pick: (s: CompanySignal) => string | null): Tally {
  const counts: Tally = {};
  for (const s of signals) {
    const raw = pick(s);
    const label = (raw ?? "").trim().toLowerCase();
    if (label === "") continue; // unknown — don't tally a phantom bucket
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

/**
 * Partition the funnel into kept vs. passed and tally category/stage frequencies
 * for each side, so the contrast is visible (e.g. "passed companies are
 * disproportionately Cybersecurity"). Pure: `Company[]` in, summary out — no DB.
 */
export function revealedPreference(companies: Company[]): RevealedPreference {
  const kept: CompanySignal[] = [];
  const passed: CompanySignal[] = [];

  for (const c of companies) {
    if (KEPT_STATUSES.includes(c.status)) kept.push(toSignal(c));
    else if (c.status === PASSED_STATUS) passed.push(toSignal(c));
    // every other status (new / enriched) is not a revealed signal — ignored.
  }

  return {
    kept,
    passed,
    summary: {
      keptCount: kept.length,
      passedCount: passed.length,
      keptCategories: tally(kept, (s) => s.category),
      passedCategories: tally(passed, (s) => s.category),
      keptStages: tally(kept, (s) => s.stage),
      passedStages: tally(passed, (s) => s.stage),
    },
  };
}
