import type { CompanyRepo } from "../db/repository";
import type { Company } from "../db/schema";
import { CostMeter } from "../providers/cost";
import { ProviderConfigError, type EnrichmentProvider } from "../providers/types";

/**
 * Company-only enrichment — firmographics, NO founders.
 *
 * Where {@link enrichCompany} deep-dives a company AND its people (rosters
 * founders, fetches profiles, writes markdown), this is the cheap firmographics
 * pass: ONE `resolveCompany` call, persist only the fields it returned, advance
 * `new → enriched`. It writes NO `people` rows and NO deep-dive markdown.
 *
 * It is what backfills `linkedin_company_id` on already-enriched companies and
 * enriches the `new` ones, without the cost of a full founder roster.
 */

export interface EnrichCompanyInfoOptions {
  /**
   * Cost meter shared with the provider. When supplied, this run's billable
   * spend (the delta over the meter while resolving this company) is returned
   * as `costUsd`. Construct one per company for accurate per-company cost.
   */
  meter?: CostMeter;
}

export interface EnrichCompanyInfoResult {
  company: Company;
  /** USD spent on this company's resolve (0 when no meter was supplied). */
  costUsd: number;
  /** Non-fatal diagnostics (e.g. a provider that degraded gracefully). */
  notes: string[];
}

/** Firmographic fields this pass may persist (never people, never markdown). */
const FIRMOGRAPHIC_FIELDS = [
  "domain",
  "linkedinUrl",
  "description",
  "sizeBand",
  "linkedinCompanyId",
  // Funding firmographics (Apollo org-enrich); company-level, no founders.
  "latestRound",
  "latestAmount",
  "lastFundingDate",
  "leadInvestor",
  "fundingTotal",
] as const;

/**
 * Enrich a single company's firmographics via the provider and persist only the
 * non-null fields it returned — never overwriting an existing value with a
 * null/undefined. Advances the company `new → enriched` (promote-to-at-least;
 * never regresses a further-along company, never touches `passed`).
 *
 * Provider is injected so tests run offline against `FakeProvider`.
 */
export async function enrichCompanyInfo(
  deps: { companies: CompanyRepo; provider: EnrichmentProvider },
  companyId: number,
  opts: EnrichCompanyInfoOptions = {},
): Promise<EnrichCompanyInfoResult> {
  const { companies, provider } = deps;
  const notes: string[] = [];

  const company = companies.get(companyId);
  if (!company) {
    throw new Error(`enrichCompanyInfo: no company with id ${companyId}`);
  }

  const costBefore = opts.meter?.totalUsd() ?? 0;

  // ONE resolve call, by whatever identity we already hold. A graceful provider
  // failure (missing key / call error) is captured as a note, not thrown, so the
  // pass can continue across a batch (PRD user-story 19).
  let resolution;
  try {
    resolution = await provider.resolveCompany({
      name: company.name,
      linkedinUrl: company.linkedinUrl ?? undefined,
      domain: company.domain ?? undefined,
      websiteUrl: company.websiteUrl ?? undefined,
      hint: company.location ?? undefined,
    });
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      notes.push(`[${provider.name}] ${err.message}`);
    } else {
      notes.push(`[${provider.name}] unexpected error: ${String(err)}`);
    }
    return finish(company);
  }

  // Persist only the non-null fields the resolution returned; never clobber a
  // present value with null/undefined. Identity collisions on domain/linkedin
  // would violate the partial-unique index — drop the conflicting field with a
  // note rather than throwing.
  const patch: Record<string, string> = {};
  for (const field of FIRMOGRAPHIC_FIELDS) {
    const value = resolution[field];
    if (typeof value === "string" && value.length > 0) {
      if ((field === "domain" || field === "linkedinUrl") && conflicts(field, value)) continue;
      patch[field] = value;
    }
  }

  if (Object.keys(patch).length > 0) {
    const updated = companies.update(companyId, patch);
    if (updated) Object.assign(company, updated);
  }

  // Advance new → enriched via promote-to-at-least: never regress a company that
  // is already further along, never touch a `passed` company.
  const promoted = companies.promoteToAtLeast(companyId, "enriched");

  return finish(promoted ?? company);

  /** Helper to build the result with this company's metered cost delta. */
  function finish(c: Company): EnrichCompanyInfoResult {
    const costUsd = Math.round(((opts.meter?.totalUsd() ?? 0) - costBefore) * 1e6) / 1e6;
    return { company: c, costUsd, notes };
  }

  /** Would writing this identity field collide with a *different* company row? */
  function conflicts(field: "domain" | "linkedinUrl", value: string): boolean {
    const other = companies.findByIdentity({ [field]: value });
    if (other && other.id !== companyId) {
      notes.push(
        `${field} "${value}" already belongs to company #${other.id} (${other.name}); not writing it.`,
      );
      return true;
    }
    return false;
  }
}

export interface EnrichCompaniesInfoDeps {
  companies: CompanyRepo;
  /**
   * Per-company provider factory: returns a fresh provider bound to the given
   * meter, so concurrent runs never share a meter (mirrors {@link enrichBatch}).
   */
  makeProvider: (meter: CostMeter) => EnrichmentProvider;
}

export interface EnrichCompaniesInfoOptions {
  /** Max companies enriched at once (default 5). */
  concurrency?: number;
  /** Invoked as each company finishes (finish order is NOT guaranteed). */
  onResult?: (result: EnrichCompanyInfoResult) => void;
}

export interface EnrichCompaniesInfoResult {
  /** One entry per company, in INPUT order (failures are skipped). */
  results: EnrichCompanyInfoResult[];
  /** Grand total USD across every company's own meter. */
  totalUsd: number;
}

/**
 * Firmographic-enrich many companies CONCURRENTLY with accurate per-company
 * cost — the company-only analogue of {@link enrichBatch}. Each company gets its
 * OWN meter + OWN provider, so per-company `costUsd` is exact even at full
 * concurrency; the grand total is summed from those per-company meters.
 *
 * A per-company failure is caught and skipped (the batch never aborts); the
 * returned `results` preserve input order over the survivors.
 */
export async function enrichCompaniesInfo(
  companyIds: number[],
  deps: EnrichCompaniesInfoDeps,
  opts: EnrichCompaniesInfoOptions = {},
): Promise<EnrichCompaniesInfoResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  const slots = new Array<EnrichCompanyInfoResult | undefined>(companyIds.length);
  let totalUsd = 0;
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const meter = new CostMeter();
    const provider = deps.makeProvider(meter);
    try {
      const result = await enrichCompanyInfo(
        { companies: deps.companies, provider },
        companyIds[index],
        { meter },
      );
      slots[index] = result;
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
    results: slots.filter((r): r is EnrichCompanyInfoResult => r !== undefined),
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
  };
}
