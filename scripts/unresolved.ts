/**
 * CLI: list the UNRESOLVED companies — those whose canonical `domain` is still
 * NULL after import + aggregator-crawl (ADR-0003 §1, "fail loud, never guess").
 *
 *   pnpm unresolved
 *
 * There is no separate `unresolved` column or status: a null domain IS the
 * unresolved set. These are the companies that need the recovery ladder (a CSV
 * re-read / `pnpm recover-domains`, web-search, or a Claude-in-Chrome pass)
 * before identity-anchored enrichment can proceed.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";

// tsx does not auto-load .env.local; do it before touching the DB.
loadEnvFile();

async function main() {
  const repo = createCompanyRepo(createDb(DB_URL));

  // Null domain == unresolved (no new column/status — ADR-0003 §1).
  const unresolved = (await repo.list()).filter((c) => !c.domain);

  if (unresolved.length === 0) {
    console.log("No unresolved companies — every company has a domain.");
    return;
  }

  console.log(`${unresolved.length} unresolved compan${unresolved.length === 1 ? "y" : "ies"} (domain IS NULL):`);
  for (const c of unresolved) {
    const detail = c.sourceDetail ? ` — source: ${c.sourceDetail}` : "";
    console.log(`· ${c.name} (#${c.id}, ${c.slug})${detail}`);
  }
}

await main();
