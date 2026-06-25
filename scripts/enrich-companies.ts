/**
 * CLI: company-only (firmographic) enrichment — backfill `linkedin_company_id`
 * and fill domain/linkedin/description/size_band, advancing `new → enriched`.
 * Writes NO people rows and NO deep-dive markdown (that's `enrich-company`).
 *
 *   pnpm enrich-companies                 # all companies (default)
 *   pnpm enrich-companies --all
 *   pnpm enrich-companies --status new    # only companies in a given status
 *   pnpm enrich-companies acme            # a single company by slug
 *   pnpm enrich-companies --concurrency 3
 *
 * Provider selection is config, not code: set ENRICHMENT_PROVIDER=harvest (with
 * HARVESTAPI_KEY) in .env.local to hit the live LinkedIn company lookup;
 * defaults to fake (offline). Missing keys degrade gracefully with a note.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { COMPANY_STATUS, type CompanyStatus } from "../src/db/schema";
import { createProvider } from "../src/providers";
import type { CostMeter } from "../src/providers/cost";
import { enrichCompaniesInfo } from "../src/enrich";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

function isCompanyStatus(v: string): v is CompanyStatus {
  return (COMPANY_STATUS as readonly string[]).includes(v);
}

async function main() {
  const args = process.argv.slice(2);

  // --concurrency N (default 5)
  let concurrency = 5;
  const concFlag = args.indexOf("--concurrency");
  if (concFlag !== -1) {
    concurrency = Number(args[concFlag + 1]) || 5;
    args.splice(concFlag, 2);
  }

  // --status <s>
  let status: CompanyStatus | undefined;
  const statusFlag = args.indexOf("--status");
  if (statusFlag !== -1) {
    const s = args[statusFlag + 1];
    if (!s || !isCompanyStatus(s)) {
      console.error(`Invalid --status "${s}". Valid: ${COMPANY_STATUS.join(", ")}.`);
      process.exit(1);
    }
    status = s;
    args.splice(statusFlag, 2);
  }

  // --all is the default selector; consume the flag if present.
  const allFlag = args.indexOf("--all");
  if (allFlag !== -1) args.splice(allFlag, 1);

  const slugs = args; // any remaining positionals are slugs

  const db = createDb(DB_URL);
  const companies = createCompanyRepo(db);

  let targets;
  if (slugs.length) {
    targets = slugs
      .map((s) => companies.getBySlug(s))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (targets.length === 0) {
      console.error(`No company found for slug(s): ${slugs.join(", ")}.`);
      process.exit(1);
    }
  } else {
    targets = companies.list(status ? { status } : undefined);
  }

  const providerKind = (process.env.ENRICHMENT_PROVIDER ?? "fake").toLowerCase();
  // Per-company provider factory: a fresh provider bound to the company's own
  // meter, so concurrent runs never share a meter (accurate per-company cost).
  const makeProvider = (meter: CostMeter) => createProvider(undefined, { meter });

  console.log(
    `Enriching firmographics for ${targets.length} company(ies) via provider ` +
      `"${providerKind}" (concurrency ${concurrency})…`,
  );

  const { results, totalUsd } = await enrichCompaniesInfo(
    targets.map((c) => c.id),
    { companies, makeProvider },
    {
      concurrency,
      onResult: (r) =>
        console.log(
          `✓ ${r.company.name} → ${r.company.domain ?? "—"} | ` +
            `companyId=${r.company.linkedinCompanyId ?? "—"} | $${r.costUsd.toFixed(4)}`,
        ),
    },
  );

  for (const r of results) for (const n of r.notes) console.log(`    ⚠ [#${r.company.id}] ${n}`);

  console.log(`Done — ${results.length} enriched. Cost $${totalUsd.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
