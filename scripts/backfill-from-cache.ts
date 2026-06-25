/**
 * CLI: backfill firmographics from the EXISTING Apollo cache — zero new API
 * spend. Earlier enrichment passes called Apollo (443 org-enrich responses are
 * cached) but persisted only a narrow slice; the widened `resolveCompany` +
 * `enrichCompanyInfo` now capture industry/keywords/location/founded_year/
 * headcount and the raw blob. This replays the cached responses through that
 * mapping for every company that already has a domain.
 *
 *   pnpm backfill-from-cache              # all companies with a domain
 *   pnpm backfill-from-cache --concurrency 8
 *
 * Cache-only by construction: the injected `fetchImpl` THROWS, so a cache miss
 * becomes a skipped company (a note), never a live billable call. No APOLLO_KEY
 * is required.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { ApolloProvider } from "../src/providers/apollo";
import { getResponseCache } from "../src/providers/cache";
import type { CostMeter } from "../src/providers/cost";
import { enrichCompaniesInfo } from "../src/enrich";

loadEnvFile();

/** A fetch that refuses to run — guarantees this backfill never bills Apollo. */
const refuseLiveCall: typeof fetch = async (input) => {
  throw new Error(
    `cache-only backfill refused a live call to ${String(input)} (not in cache)`,
  );
};

async function main() {
  const args = process.argv.slice(2);

  let concurrency = 8;
  const concFlag = args.indexOf("--concurrency");
  if (concFlag !== -1) {
    concurrency = Number(args[concFlag + 1]) || 8;
    args.splice(concFlag, 2);
  }

  const db = createDb(DB_URL);
  const companies = createCompanyRepo(db);
  const cache = getResponseCache();

  // Only companies we can key Apollo by (domain is Apollo's natural key).
  const targets = companies.list().filter((c) => c.domain && c.domain.length > 0);

  // Per-company Apollo provider: real cache, throwing fetch, dummy key (the key
  // check passes but cache hits short-circuit before any fetch).
  const makeProvider = (meter: CostMeter) =>
    new ApolloProvider({ apiKey: "cache-only", fetchImpl: refuseLiveCall, cache, meter });

  console.log(
    `Backfilling firmographics from cache for ${targets.length} company(ies) ` +
      `(concurrency ${concurrency}, zero API spend)…`,
  );

  let hit = 0;
  let miss = 0;
  const { results } = await enrichCompaniesInfo(
    targets.map((c) => c.id),
    { companies, makeProvider },
    {
      concurrency,
      onResult: (r) => {
        const filled = [
          r.company.industry && "industry",
          r.company.keywords && "keywords",
          r.company.location && "location",
          r.company.foundedYear && "founded",
          r.company.headcount && "headcount",
        ].filter(Boolean);
        // A cache miss surfaces as a provider note from enrichCompanyInfo.
        const missed = r.notes.some((n) => n.includes("refused a live call"));
        if (missed) {
          miss++;
        } else {
          hit++;
          console.log(`✓ ${r.company.name}: ${filled.join(", ") || "(no new fields)"}`);
        }
      },
    },
  );

  console.log(
    `Done — ${results.length} processed: ${hit} from cache, ${miss} not cached (skipped, no spend).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
