/**
 * Cost metering for billable provider calls.
 *
 * HarvestAPI charges per call, by kind (see pricing). The meter is injected into
 * a provider; the provider records each successful call, and the caller (an
 * enrich/resolve run) reads `summary()` afterwards to show and persist spend.
 * This is the one place call-kind → dollars lives, so re-pricing is a data edit.
 */

/** Billable call kinds and their USD unit cost (HarvestAPI pricing). */
export const COST_TABLE = {
  /** Full LinkedIn profile (experience, education, about). */
  profile: 0.0064,
  /** One profile-search page. */
  profileSearch: 0.004,
  /** One company lookup. */
  company: 0.004,
  /** One company-search page. */
  companySearch: 0.004,
  /** One HarvestAPI LinkedIn job-search page. */
  jobSearch: 0.004,
  /** A web/jobs search via SearchAPI (rough; not HarvestAPI pricing). */
  webSearch: 0.001,
  /**
   * One Apollo call (org-enrich or people-search). Placeholder ~0.01 USD:
   * Apollo bills in credits, not dollars, so this is a rough per-call estimate
   * (org-enrich ~1 credit; people-search free) for run-cost readouts.
   */
  apollo: 0.01,
} as const;

export type CostKind = keyof typeof COST_TABLE;

export interface CostSummary {
  /** Per-kind call counts. */
  counts: Record<CostKind, number>;
  /** Total USD across all recorded calls. */
  totalUsd: number;
  /** Total billable calls recorded. */
  totalCalls: number;
}

/** Map a HarvestAPI request path to its billable kind (undefined = not billed). */
export function kindForPath(path: string): CostKind | undefined {
  if (path.startsWith("/linkedin/profile-search")) return "profileSearch";
  if (path.startsWith("/linkedin/profile")) return "profile";
  if (path.startsWith("/linkedin/company-search")) return "companySearch";
  if (path.startsWith("/linkedin/company")) return "company";
  if (path.startsWith("/linkedin/job-search")) return "jobSearch";
  return undefined;
}

/**
 * Accumulates billable calls for one run. Construct fresh per logical unit
 * (e.g. per company enriched) when you want per-unit cost, or once per process
 * for a grand total.
 */
export class CostMeter {
  private readonly counts: Record<CostKind, number> = {
    profile: 0,
    profileSearch: 0,
    company: 0,
    companySearch: 0,
    jobSearch: 0,
    webSearch: 0,
    apollo: 0,
  };

  /** Record one billable call of the given kind. */
  record(kind: CostKind): void {
    this.counts[kind] += 1;
  }

  /** Record a HarvestAPI call by its request path (no-op for un-billed paths). */
  recordPath(path: string): void {
    const kind = kindForPath(path);
    if (kind) this.record(kind);
  }

  totalUsd(): number {
    let sum = 0;
    for (const kind of Object.keys(this.counts) as CostKind[]) {
      sum += this.counts[kind] * COST_TABLE[kind];
    }
    // Avoid float dust in displayed/persisted values.
    return Math.round(sum * 1e6) / 1e6;
  }

  summary(): CostSummary {
    let totalCalls = 0;
    for (const kind of Object.keys(this.counts) as CostKind[]) totalCalls += this.counts[kind];
    return { counts: { ...this.counts }, totalUsd: this.totalUsd(), totalCalls };
  }

  /** One-line, human-readable cost breakdown for CLI output. */
  format(): string {
    const s = this.summary();
    const parts = (Object.keys(s.counts) as CostKind[])
      .filter((k) => s.counts[k] > 0)
      .map((k) => `${s.counts[k]} ${k}`);
    return `$${s.totalUsd.toFixed(4)} (${s.totalCalls} calls: ${parts.join(", ") || "none"})`;
  }
}
