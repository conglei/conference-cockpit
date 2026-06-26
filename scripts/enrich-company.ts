/**
 * CLI: deep-dive a company and its founders/key people in one pass.
 *
 *   pnpm enrich-company <slug>     # enrich a single company by slug
 *   pnpm enrich-company            # enrich all companies still `new`
 *
 * Writes `companies/<slug>.md` + founder `people/<slug>.md` deep-dives, creates
 * and links `people` rows, sets deep_dive_path/notes_path, and advances the
 * company new → enriched.
 *
 * Provider selection is config, not code: set ENRICHMENT_PROVIDER=fake|harvest|searchapi
 * in .env.local (defaults to fake). Missing keys degrade gracefully and print
 * exactly what to configure.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createProvider, SearchApiProvider } from "../src/providers";
import { CostMeter } from "../src/providers/cost";
import { enrichCompany } from "../src/enrich";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

async function main() {
  const arg = process.argv[2];
  const db = createDb();
  const companies = createCompanyRepo(db);
  const people = createPersonRepo(db);

  // One meter for the whole run, shared by both providers so every billable
  // call (LinkedIn + web search) rolls up into one displayed/persisted cost.
  const meter = new CostMeter();
  const provider = createProvider(undefined, { meter });

  // Web-search supplement: only wire a real SearchAPI when its key exists, and
  // skip it if the primary provider already IS searchapi (no double call).
  const searchProvider =
    provider.name !== "searchapi" && process.env.SEARCHAPI_KEY
      ? new SearchApiProvider({ meter })
      : undefined;

  const targets = arg
    ? [await companies.getBySlug(arg)].filter((c): c is NonNullable<typeof c> => Boolean(c))
    : await companies.list({ status: "new" });

  if (arg && targets.length === 0) {
    console.error(`No company with slug "${arg}".`);
    process.exit(1);
  }

  console.log(
    `Enriching ${targets.length} company(ies) via provider "${provider.name}"` +
      (searchProvider ? " + web-search supplement" : "") +
      "…",
  );

  for (const c of targets) {
    const r = await enrichCompany(
      { companies, people, provider },
      c.id,
      { searchProvider, meter },
    );
    console.log(
      `✓ ${c.name} (#${c.id}) → ${r.company.status}; ${r.people.length} person(s); ` +
        `$${r.costUsd.toFixed(4)}; ${r.deepDivePath}`,
    );
    for (const p of r.people) console.log(`    · ${p.person.name} → ${p.notesPath}`);
    for (const n of r.notes) console.log(`    ⚠ ${n}`);
  }

  console.log(`Done — ${targets.length} company(ies) enriched. Cost: ${meter.format()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
