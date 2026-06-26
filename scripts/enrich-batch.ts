/**
 * CLI: enrich many companies CONCURRENTLY with accurate per-company cost.
 *
 *   pnpm enrich-batch                  # enrich all companies still `new`
 *   pnpm enrich-batch acme giga        # enrich specific companies by slug
 *
 * Unlike `enrich-company` (one shared meter for a sequential run), this gives
 * EACH company its own CostMeter + own provider instances, so the persisted
 * per-company `enrichment_cost` is correct even though companies run in
 * parallel (ADR-0003 §"per-company cost meter"). A grand total is summed from
 * the per-company meters.
 *
 * Provider selection is config, not code: set ENRICHMENT_PROVIDER=fake|harvest|searchapi
 * in .env.local (defaults to fake). Missing keys degrade gracefully.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createProvider, SearchApiProvider } from "../src/providers";
import type { CostMeter } from "../src/providers/cost";
import { enrichBatch } from "../src/enrich";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

async function main() {
  const slugs = process.argv.slice(2);
  const db = createDb();
  const companies = createCompanyRepo(db);
  const people = createPersonRepo(db);

  const targets = slugs.length
    ? (await Promise.all(slugs.map((s) => companies.getBySlug(s)))).filter(
        (c): c is NonNullable<typeof c> => Boolean(c),
      )
    : await companies.list({ status: "new" });

  if (slugs.length && targets.length === 0) {
    console.error(`No company found for slug(s): ${slugs.join(", ")}.`);
    process.exit(1);
  }

  // Per-company provider factory: fresh providers bound to the company's own
  // meter, so concurrent runs never share a meter (the bug this CLI fixes).
  const makeProvider = (meter: CostMeter) => ({
    provider: createProvider(undefined, { meter }),
    searchProvider: process.env.SEARCHAPI_KEY
      ? new SearchApiProvider({ meter })
      : undefined,
  });

  const providerKind = (process.env.ENRICHMENT_PROVIDER ?? "fake").toLowerCase();
  console.log(
    `Enriching ${targets.length} company(ies) concurrently via provider ` +
      `"${providerKind}"` +
      (process.env.SEARCHAPI_KEY ? " + web-search supplement" : "") +
      "…",
  );

  const { results, totalUsd } = await enrichBatch(
    targets.map((c) => c.id),
    { companies, people, makeProvider },
    {
      onResult: (r) =>
        console.log(
          `✓ ${r.company.name} (#${r.company.id}) → ${r.company.status}; ` +
            `${r.people.length} person(s); $${r.costUsd.toFixed(4)}; ${r.deepDivePath}`,
        ),
    },
  );

  for (const r of results) for (const n of r.notes) console.log(`    ⚠ [#${r.company.id}] ${n}`);

  console.log(
    `Done — ${results.length}/${targets.length} company(ies) enriched. ` +
      `Grand total: $${totalUsd.toFixed(4)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
