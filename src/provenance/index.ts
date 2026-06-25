/**
 * Provenance + freshness foundation (product-design.md §11 Phase 0).
 *
 * The trust spine: every enriched claim the plan engine emits must be able to
 * render a **source** + an **"as of" date**, and a *thin* signal (unknown/stale
 * source) must be labeled and rank LOW rather than be dressed up as fact
 * (design objective: "thin signal → say so and rank low"; §8 risk #2).
 *
 * We do NOT add a per-field provenance column + backfill migration. The origin
 * of every field is already recoverable from the row (`source`/`source_detail`,
 * the field-specific date columns, `updated_at`), so provenance is *derived at
 * read time* by the helpers below. That keeps the DB untouched and the logic
 * pure + unit-testable.
 */

/** A single field's provenance: where the value came from and when it was true. */
export interface Provenance {
  /** Canonical source key (e.g. "apollo", "csv", "ats"). */
  source: string;
  /**
   * When the value was last known true. Accepts the three shapes the DB uses:
   * epoch-ms number (`updated_at`), ISO-8601 string (`roles.posted_date`), or a
   * `YYYY-MM-DD` string (`companies.last_funding_date`). `null` = unknown.
   */
  asOf: number | string | null;
  /** `thin` when the signal is weak (unknown/stale/low-confidence source). */
  confidence: "high" | "thin";
}

export interface Freshness {
  asOf: number | string | null;
  /** Age in whole days, or `null` if `asOf` is missing/unparseable. */
  ageDays: number | null;
  /** Human label: "today", "5d ago", "3mo ago", "over a year ago", "unknown". */
  label: string;
  /** True when older than STALE_DAYS or the date is unknown. */
  stale: boolean;
}

/** A value paired with its provenance — the shape the plan engine emits. */
export interface Provenanced<T> {
  value: T;
  provenance: Provenance;
}

/** Older than this (or unknown date) counts as stale → a thin signal. */
export const STALE_DAYS = 180;

/** Display names for canonical source keys. Unknown keys title-case the key. */
const SOURCE_LABELS: Record<string, string> = {
  apollo: "Apollo",
  harvest: "LinkedIn (Harvest)",
  searchapi: "Google",
  ats: "ATS board",
  google_jobs: "Google Jobs",
  csv: "CSV import",
  startups_gallery: "startups.gallery",
  manual: "manual",
  browser: "web page",
  directory: "AIE 2026 directory",
};

/** Sources whose values are low-confidence even when freshly dated. */
const THIN_SOURCES = new Set<string>(["manual"]);

export function sourceLabel(source: string): string {
  return (
    SOURCE_LABELS[source] ??
    source.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Parse any of the three DB date shapes to epoch-ms, or `null` if unparseable.
 * Bare `YYYY-MM-DD` is read as UTC midnight so it doesn't drift by timezone.
 */
export function parseAsOf(asOf: number | string | null | undefined): number | null {
  if (asOf == null) return null;
  if (typeof asOf === "number") return Number.isFinite(asOf) ? asOf : null;
  const s = asOf.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

const DAY_MS = 86_400_000;

export function freshness(
  asOf: number | string | null | undefined,
  now: Date = new Date(),
): Freshness {
  const ms = parseAsOf(asOf);
  if (ms == null) {
    return { asOf: asOf ?? null, ageDays: null, label: "unknown", stale: true };
  }
  const ageDays = Math.max(0, Math.floor((now.getTime() - ms) / DAY_MS));
  return {
    asOf: asOf ?? null,
    ageDays,
    label: ageLabel(ageDays),
    stale: ageDays > STALE_DAYS,
  };
}

function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) {
    const mo = Math.round(days / 30);
    return `${mo}mo ago`;
  }
  if (days < 730) return "over a year ago";
  return `${Math.floor(days / 365)}y ago`;
}

/** A signal is thin when its date is stale/unknown or its source is low-confidence. */
export function isThin(prov: Provenance, now: Date = new Date()): boolean {
  if (prov.confidence === "thin") return true;
  if (THIN_SOURCES.has(prov.source)) return true;
  return freshness(prov.asOf, now).stale;
}

/**
 * Multiplicative ranking penalty for a thin claim (∈ (0,1]). Fresh & confident
 * = 1.0; unknown date = 0.5; merely stale = 0.7. The plan engine multiplies a
 * claim's contribution by this so weak signals rank low instead of being hidden.
 */
export function rankPenalty(prov: Provenance, now: Date = new Date()): number {
  const f = freshness(prov.asOf, now);
  if (f.ageDays == null) return 0.5;
  if (THIN_SOURCES.has(prov.source)) return 0.6;
  if (f.stale) return 0.7;
  return 1;
}

/** Render a chip string for the UI/CLI: `"Apollo · as of 5d ago"`. */
export function formatChip(prov: Provenance, now: Date = new Date()): string {
  const f = freshness(prov.asOf, now);
  const when = f.ageDays == null ? "date unknown" : `as of ${f.label}`;
  return `${sourceLabel(prov.source)} · ${when}`;
}

/** Build a Provenance, auto-deriving confidence from source + date. */
export function makeProvenance(
  source: string,
  asOf: number | string | null,
  now: Date = new Date(),
): Provenance {
  const base: Provenance = { source, asOf, confidence: "high" };
  base.confidence = isThin(base, now) ? "thin" : "high";
  return base;
}

// --- Per-entity derivation (the only place that knows column→source mapping) ---

interface CompanyLike {
  source?: string | null;
  sourceDetail?: string | null;
  lastFundingDate?: string | null;
  updatedAt?: number | null;
}
interface RoleLike {
  source?: string | null;
  postedDate?: string | null;
  lastSeenAt?: string | null;
  updatedAt?: number | null;
}
interface PersonLike {
  updatedAt?: number | null;
}

/**
 * Funding fields (round/amount/total/investor) are only ever populated by the
 * Apollo company enrichment — `companies.source` records the *import* origin, not
 * the funding origin — so funding provenance is Apollo, dated by the funding date.
 */
export function companyFundingProvenance(
  c: CompanyLike,
  now: Date = new Date(),
): Provenance {
  return makeProvenance("apollo", c.lastFundingDate ?? c.updatedAt ?? null, now);
}

/** Identity/firmographic fields trace to the import/resolve source + updated_at. */
export function companyIdentityProvenance(
  c: CompanyLike,
  now: Date = new Date(),
): Provenance {
  return makeProvenance(c.source ?? "manual", c.updatedAt ?? null, now);
}

/** A role's provenance: its own source, dated by posted-date then last-seen. */
export function roleProvenance(r: RoleLike, now: Date = new Date()): Provenance {
  return makeProvenance(
    r.source ?? "manual",
    r.postedDate ?? r.lastSeenAt ?? r.updatedAt ?? null,
    now,
  );
}

/** Speakers/attendees come from the conference directory ingest. */
export function personProvenance(p: PersonLike, now: Date = new Date()): Provenance {
  return makeProvenance("directory", p.updatedAt ?? null, now);
}
