/**
 * Shortlist selection for the LLM **deep-review** pass (ADR-0003 §3).
 *
 * The rubric (FakeScorer / the deterministic path) triages *every* company into
 * tiers. Per-company LLM judgment over hundreds of rows on each re-score is too
 * slow/expensive, so the deep-review is **tier-gated on `rank ∩ coverage`**:
 * only companies that already have a rubric `scoreOverall` **and** carry real
 * co-dominant signal are worth a verdict.
 *
 * `selectShortlist` is the deterministic gate the `score-companies` skill calls
 * to decide *which* companies it (acting as the LLM `Scorer`) deep-reviews. It
 * makes no taste judgment — it only ranks and filters on signal that already
 * exists on the row.
 */
import type { Company } from "../db/schema";

export interface ShortlistOptions {
  /** Cap the shortlist to the top-N by `scoreOverall` (default 50). */
  limit?: number;
  /** Drop anything below this rubric `scoreOverall` before capping. */
  minOverall?: number;
}

/** Default deep-review tier size (ADR-0003 §3: "~50 companies"). */
export const DEFAULT_SHORTLIST_LIMIT = 50;

/**
 * A company has **coverage** when at least one co-dominant axis is present
 * (`scoreFounderQuality != null` OR `scoreInvestorQuality != null`). A row with
 * *both* co-dominant axes NULL is something we can't actually evaluate yet — it
 * belongs in the recovery / re-enrich queue (ADR-0003 §2), not the deep-review
 * pass, so we never hand the LLM a hollow row to conclude "unknown".
 */
export function hasCoverage(c: Company): boolean {
  return c.scoreFounderQuality != null || c.scoreInvestorQuality != null;
}

/**
 * Select the deep-review tier: companies that
 *   (a) already have a rubric `scoreOverall` (have been triaged), and
 *   (b) have **coverage** — at least one co-dominant axis present,
 * sorted by `scoreOverall` descending, then filtered by `minOverall` and capped
 * at `limit` (default 50). Companies missing both co-dominant axes are EXCLUDED
 * (they route to the recovery queue, not deep-review).
 *
 * Pure and deterministic — no DB writes, no model calls.
 */
export function selectShortlist(companies: Company[], opts: ShortlistOptions = {}): Company[] {
  const limit = opts.limit ?? DEFAULT_SHORTLIST_LIMIT;
  const minOverall = opts.minOverall;

  const eligible = companies.filter((c) => {
    if (c.scoreOverall == null) return false; // not yet triaged by the rubric
    if (!hasCoverage(c)) return false; // zero co-dominant coverage → recovery queue
    if (minOverall != null && c.scoreOverall < minOverall) return false;
    return true;
  });

  eligible.sort((a, b) => {
    // Both have a non-null scoreOverall (filtered above). Highest first.
    const diff = (b.scoreOverall as number) - (a.scoreOverall as number);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name) || a.id - b.id;
  });

  return limit >= 0 ? eligible.slice(0, limit) : eligible;
}
