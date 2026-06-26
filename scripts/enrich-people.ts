/**
 * CLI: deep per-person profile enrichment — fetch each person's LinkedIn profile
 * (work history, education, headline, about, location) and persist it to the
 * dedicated `people` columns. Writes NO company rows.
 *
 *   pnpm enrich-people                       # everyone with a linkedin_url
 *   pnpm enrich-people --limit 5             # first N (validate before a full run)
 *   pnpm enrich-people --vertical Healthcare # only people whose company is in a vertical
 *   pnpm enrich-people ada-lovelace          # a single person by slug
 *   pnpm enrich-people --concurrency 6
 *
 * Provider is config: set ENRICHMENT_PROVIDER=harvest (+ HARVESTAPI_KEY) for the
 * live LinkedIn profile lookup; cached calls are free on re-run. Missing keys
 * degrade gracefully with a note. Cost ~$0.0064/profile (HarvestAPI).
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { createProvider } from "../src/providers";
import type { CostMeter } from "../src/providers/cost";
import { enrichPeople } from "../src/enrich";

loadEnvFile();

async function main() {
  const args = process.argv.slice(2);

  let concurrency = 5;
  const c = args.indexOf("--concurrency");
  if (c !== -1) {
    concurrency = Number(args[c + 1]) || 5;
    args.splice(c, 2);
  }

  let limit: number | undefined;
  const l = args.indexOf("--limit");
  if (l !== -1) {
    limit = Number(args[l + 1]) || undefined;
    args.splice(l, 2);
  }

  let vertical: string | undefined;
  const v = args.indexOf("--vertical");
  if (v !== -1) {
    vertical = args[v + 1];
    args.splice(v, 2);
  }

  const slugs = args;

  const db = createDb();
  const people = createPersonRepo(db);
  const companies = createCompanyRepo(db);

  let targets = slugs.length
    ? (await Promise.all(slugs.map((s) => people.getBySlug(s)))).filter(
        (p): p is NonNullable<typeof p> => Boolean(p),
      )
    : await people.list();

  // --vertical: keep only people whose company carries that vertical.
  if (vertical) {
    const ok = new Set(
      (await companies.list())
        .filter((co) => (co.verticals ?? "").toLowerCase().includes(vertical!.toLowerCase()))
        .map((co) => co.id),
    );
    targets = targets.filter((p) => p.companyId != null && ok.has(p.companyId));
  }

  // The profile endpoint needs a LinkedIn URL.
  targets = targets.filter((p) => p.linkedinUrl);
  if (limit) targets = targets.slice(0, limit);

  if (targets.length === 0) {
    console.error("No matching people with a linkedin_url to enrich.");
    process.exit(1);
  }

  const providerKind = (process.env.ENRICHMENT_PROVIDER ?? "fake").toLowerCase();
  const makeProvider = (meter: CostMeter) => createProvider(undefined, { meter });

  console.log(
    `Enriching ${targets.length} person(s) via "${providerKind}" (concurrency ${concurrency})…`,
  );

  let enriched = 0;
  const { results, totalUsd } = await enrichPeople(
    targets.map((p) => p.id),
    { people, makeProvider },
    {
      concurrency,
      onResult: (r) => {
        const wh = r.person.workHistory ? JSON.parse(r.person.workHistory).length : 0;
        const got = r.person.profileEnrichedAt && r.notes.length === 0;
        if (got) enriched++;
        console.log(
          `${got ? "✓" : "·"} ${r.person.name} — ${r.person.currentCompany ?? "—"} | ` +
            `${wh} roles | $${r.costUsd.toFixed(4)}` +
            (r.notes.length ? ` | ${r.notes[0]}` : ""),
        );
      },
    },
  );

  console.log(`Done — ${enriched}/${results.length} enriched. Cost $${totalUsd.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
