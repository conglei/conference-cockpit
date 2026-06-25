import type { CompanyRepo } from "../db/repository";
import type { PersonRepo } from "../db/people-repository";
import { CostMeter } from "../providers/cost";
import type { EnrichmentProvider } from "../providers/types";
import { enrichCompany, type EnrichCompanyResult } from "./enrich-company";

/**
 * Build a fresh set of providers bound to a meter. Called ONCE PER COMPANY so
 * each company gets its own provider instances writing into its own meter —
 * the whole point of {@link enrichBatch}. The returned `searchProvider` is the
 * optional web/funding supplement; omit it to reuse the primary provider.
 */
export type MakeProvider = (meter: CostMeter) => {
  provider: EnrichmentProvider;
  searchProvider?: EnrichmentProvider;
};

export interface EnrichBatchDeps {
  companies: CompanyRepo;
  people: PersonRepo;
  makeProvider: MakeProvider;
}

export interface EnrichBatchOptions {
  /** Max companies enriched at once (default 5). */
  concurrency?: number;
  /** Base dir for deep-dive markdown, forwarded to each {@link enrichCompany}. */
  baseDir?: string;
  /** Invoked as each company finishes (input order is NOT guaranteed here). */
  onResult?: (result: EnrichCompanyResult) => void;
}

export interface EnrichBatchResult {
  /** One entry per successfully enriched company, in INPUT order. */
  results: EnrichCompanyResult[];
  /** Grand total USD across every company's own meter. */
  totalUsd: number;
}

/**
 * Enrich many companies CONCURRENTLY with ACCURATE per-company cost.
 *
 * The parallel-scaling bug (ADR-0003 §"per-company cost meter") was that one
 * shared {@link CostMeter} across concurrent {@link enrichCompany} calls made
 * each company's delta-over-the-meter overlap its neighbours' calls — every
 * persisted `enrichment_cost` was inflated while the grand total stayed right.
 *
 * The fix is isolation, not serialization: each company gets its OWN meter and
 * OWN provider instances (via `deps.makeProvider`), so `result.costUsd` (a
 * delta over a meter only THIS company writes to) is exact even at full
 * concurrency. We sum each company's `meter.totalUsd()` for the grand total —
 * never a single shared meter — so the total is the true sum of the parts.
 *
 * Resilience: a per-company failure is caught and skipped (the batch never
 * aborts); the returned `results` preserve input order over the survivors.
 */
export async function enrichBatch(
  companyIds: number[],
  deps: EnrichBatchDeps,
  opts: EnrichBatchOptions = {},
): Promise<EnrichBatchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  // Slot per input id so survivors keep input order regardless of finish order.
  const slots = new Array<EnrichCompanyResult | undefined>(companyIds.length);
  let totalUsd = 0;
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const id = companyIds[index];

    // Per-company isolation: fresh meter + fresh providers. This is what makes
    // the cost attribution correct under company-level parallelism.
    const meter = new CostMeter();
    const { provider, searchProvider } = deps.makeProvider(meter);

    try {
      const result = await enrichCompany(
        { companies: deps.companies, people: deps.people, provider },
        id,
        { searchProvider, meter, baseDir: opts.baseDir },
      );
      slots[index] = result;
      // Sum each company's OWN meter — never one shared meter — so the grand
      // total is the true sum of the (now-accurate) per-company costs.
      totalUsd += meter.totalUsd();
      opts.onResult?.(result);
    } catch {
      // Tolerate a single company's failure: skip it, keep the batch going.
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, companyIds.length) },
    async () => {
      while (next < companyIds.length) {
        const i = next++;
        await runOne(i);
      }
    },
  );
  await Promise.all(workers);

  return {
    results: slots.filter((r): r is EnrichCompanyResult => r !== undefined),
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
  };
}
