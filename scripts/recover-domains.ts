/**
 * CLI: recover REAL company domains for already-imported companies by crawling
 * their source aggregator page (ADR-0003 §1, roadmap step 2).
 *
 *   pnpm recover-domains <source.csv>
 *
 * The source CSV (the startups.gallery export) carries `Name` and `URL` columns,
 * where `URL` is the per-company aggregator link. That link is a TRANSIENT
 * resolution input — we re-read it here, crawl it to derive the real domain +
 * website, overwrite those on the row, and NEVER store the aggregator URL.
 * Companies whose crawl returns nothing are left as-is for the recovery ladder.
 */
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { parseCsv } from "../src/import/csv";
import { normalizeName, recoverDomains } from "../src/providers/recover-domains";

// tsx does not auto-load .env.local; do it before touching the DB/providers.
loadEnvFile();

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: pnpm recover-domains <source.csv>");
    process.exit(1);
  }

  const { rows } = parseCsv(await readFile(csvPath, "utf8"));

  // Build the TRANSIENT name → aggregator-URL map from the CSV (never persisted).
  const nameToAggregatorUrl = new Map<string, string>();
  for (const row of rows) {
    const name = (row["Name"] ?? "").trim();
    const url = (row["URL"] ?? "").trim();
    if (name && url) nameToAggregatorUrl.set(normalizeName(name), url);
  }

  if (nameToAggregatorUrl.size === 0) {
    console.error(
      `No (Name, URL) pairs found in "${csvPath}" — expected "Name" and "URL" columns.`,
    );
    process.exit(1);
  }

  const repo = createCompanyRepo(createDb(DB_URL));
  console.log(
    `Recovering domains from "${csvPath}" (${nameToAggregatorUrl.size} aggregator URLs)…`,
  );

  const result = await recoverDomains(repo, nameToAggregatorUrl, undefined, {
    onResult: (e) => {
      const id = `${e.company.name} (#${e.company.id})`;
      if (e.unmapped) return; // no aggregator URL for this company; stay quiet
      if (e.recovered) {
        console.log(`✓ ${id} → domain=${e.recovered.domain} website=${e.recovered.websiteUrl}`);
      } else if (e.collidedDomain) {
        console.log(`⚠ ${id} → ${e.collidedDomain} already owned by another company (skipped — likely duplicate)`);
      } else {
        console.log(`· ${id} unresolved (crawl found no domain)`);
      }
    },
  });

  console.log(
    `Done — ${result.recovered} recovered, ${result.unresolved} unresolved, ${result.collided} collided (skipped).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
