/**
 * Stage 1 of the hybrid scorer — the **deterministic pre-filter** (ADR-0002:
 * this is a deterministic primitive, NOT judgment). Pure logic over a `companies`
 * row: stage, location / work_type, category, and a company **size-band**
 * ("not too big — established-lab-app-side or small startup, not scaled").
 *
 * Input rows → surviving rows. No tokens spent, no network, no LLM. This is the
 * highest-value unit-test surface (PRD "Testing Decisions"): it encodes the
 * size-band / stage / category taste rules and is tested directly (rows →
 * expected survivors).
 *
 * The *criteria* come from `preferences.md` ("Hard pre-filter criteria"), parsed
 * leniently by `parsePrefilter` in `./weights.ts`. The matching here is
 * deliberately lenient and case-insensitive: a criterion is a set of allowed
 * tokens; a row passes an axis if it has no value (unknown, don't drop) or any
 * of its tokens matches an allowed token. An empty/omitted criterion means
 * "no constraint on this axis".
 */
import type { Company } from "../db/schema";

/**
 * The hard pre-filter criteria, all optional. Each axis is a list of allowed
 * values in lower-case; an absent/empty axis imposes no constraint.
 *
 * `sizeBands` lists the allowed `companies.size_band` buckets (e.g.
 * `["tiny","small","mid"]` to exclude `large`). This is how "not too big" is
 * encoded deterministically.
 */
export interface PrefilterCriteria {
  /** Allowed stages (substring match against `company.stage`), e.g. ["seed","series a"]. */
  stages?: string[];
  /** Allowed locations (substring match against `company.location`), e.g. ["san francisco","sf","bay area"]. */
  locations?: string[];
  /** Allowed work types (exact match against the `work_type` enum), e.g. ["onsite","hybrid"]. */
  workTypes?: string[];
  /** Allowed categories (substring match against `company.category`), e.g. ["ai","agents","data"]. */
  categories?: string[];
  /** Allowed size bands (exact match against `company.size_band`), e.g. ["tiny","small","mid"]. */
  sizeBands?: string[];
  /** Hard exclusions: if any of these substrings appears in name/category/description, drop the row. */
  excludeKeywords?: string[];
}

/** Why a single company was dropped — useful for the CLI readout and tests. */
export interface PrefilterDrop {
  company: Company;
  /** The first axis that failed: "stage" | "location" | "work_type" | "category" | "size_band" | "exclude". */
  axis: string;
  reason: string;
}

export interface PrefilterResult {
  survivors: Company[];
  dropped: PrefilterDrop[];
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** A row passes a substring axis if the value is empty (unknown) or contains an allowed token. */
function passesSubstring(value: string | null | undefined, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true; // no constraint
  const v = norm(value);
  if (v === "") return true; // unknown — don't drop on missing data
  return allowed.some((a) => v.includes(norm(a)));
}

/** A row passes an exact-match axis if the value is empty (unknown) or equals an allowed token. */
function passesExact(value: string | null | undefined, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const v = norm(value);
  if (v === "") return true;
  return allowed.some((a) => v === norm(a));
}

/**
 * Decide whether one company survives the pre-filter, returning the failing axis
 * if it doesn't. Pure: no I/O.
 */
export function prefilterOne(
  company: Company,
  criteria: PrefilterCriteria,
): { ok: true } | { ok: false; axis: string; reason: string } {
  // Hard exclusions first (deal-breakers).
  if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
    const haystack = [company.name, company.category, company.description].map(norm).join(" ");
    const hit = criteria.excludeKeywords.find((k) => k && haystack.includes(norm(k)));
    if (hit) {
      return { ok: false, axis: "exclude", reason: `matched deal-breaker keyword "${hit}"` };
    }
  }

  if (!passesSubstring(company.stage, criteria.stages)) {
    return { ok: false, axis: "stage", reason: `stage "${company.stage}" not in allowed set` };
  }
  if (!passesSubstring(company.location, criteria.locations)) {
    return { ok: false, axis: "location", reason: `location "${company.location}" not in allowed set` };
  }
  if (!passesExact(company.workType, criteria.workTypes)) {
    return { ok: false, axis: "work_type", reason: `work_type "${company.workType}" not in allowed set` };
  }
  if (!passesSubstring(company.category, criteria.categories)) {
    return { ok: false, axis: "category", reason: `category "${company.category}" not in allowed set` };
  }
  if (!passesExact(company.sizeBand, criteria.sizeBands)) {
    return { ok: false, axis: "size_band", reason: `size_band "${company.sizeBand}" not in allowed set (too big?)` };
  }

  return { ok: true };
}

/**
 * Stage 1: narrow a set of company rows to those worth spending LLM tokens on.
 * Pure function — input rows → { survivors, dropped }.
 */
export function prefilter(companies: Company[], criteria: PrefilterCriteria): PrefilterResult {
  const survivors: Company[] = [];
  const dropped: PrefilterDrop[] = [];
  for (const c of companies) {
    const r = prefilterOne(c, criteria);
    if (r.ok) survivors.push(c);
    else dropped.push({ company: c, axis: r.axis, reason: r.reason });
  }
  return { survivors, dropped };
}
