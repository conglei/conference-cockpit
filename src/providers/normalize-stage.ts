/**
 * Normalize a funding-round name (Apollo `latest_funding_stage`, stored as
 * `company.latest_round`) into a clean company **stage** the pre-filter can read.
 *
 * Why this exists: `company.stage` was only ever populated by the CSV import
 * (~13% of rows), while Apollo enrichment populates `latest_round` for ~50% —
 * but `latest_round` is the raw event name, which includes non-fundraising
 * events ("Merger / Acquisition", "Debt Financing", "Venture (Round not
 * Specified)", "Other"). This maps the *fundraising* rounds to a canonical stage
 * and returns `null` for everything else (genuinely unknown stage — never a
 * fabricated value). Used at snapshot-export time to backfill `stage` from
 * `latest_round` so the demo data is well-populated for filtering/ranking.
 */
export function normalizeStage(round: string | null | undefined): string | null {
  if (!round) return null;
  const s = round.trim().toLowerCase();
  if (/pre[\s-]?seed/.test(s)) return "Pre-Seed";
  if (/\bseed\b/.test(s)) return "Seed";
  const m = s.match(/series\s+([a-h])\b/);
  if (m) return `Series ${m[1].toUpperCase()}`;
  if (/\bangel\b/.test(s)) return "Angel";
  // Non-fundraising events (M&A, debt, IPO, "Venture (Round not Specified)",
  // "Other") carry no clean stage → leave it unknown.
  return null;
}
