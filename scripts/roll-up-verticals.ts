/**
 * CLI: derive each company's conference verticals from its speakers' talk tracks
 * and persist them to `companies.verticals`. No input — reads the `talks` table.
 *
 *   pnpm roll-up-verticals
 *
 * Idempotent: re-running recomputes from the current talks. Run after talks are
 * ingested (pnpm ingest-talks).
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { rollUpVerticals } from "../src/talks/roll-up-verticals";

loadEnvFile();

async function main() {
  const db = createDb();
  const res = await rollUpVerticals({
    companies: createCompanyRepo(db),
    talks: createTalkRepo(db),
  });

  console.log(`Verticals rolled up onto ${res.companiesUpdated} company(ies).`);
  console.log(`Distinct verticals (${res.distinctVerticals.length}):`);
  for (const v of res.distinctVerticals) console.log(`  - ${v}`);
}

await main();
