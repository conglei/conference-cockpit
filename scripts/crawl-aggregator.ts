/**
 * CLI: one-off aggregator crawl over EVERY company in the source CSV — re-anchor
 * identity on startups.gallery (ADR-0003 §1, issue #38).
 *
 *   pnpm crawl-aggregator [source.csv]   # defaults to ~/Downloads/san-francisco-startups.csv
 *
 * The source CSV (the startups.gallery export) carries `Name` and `URL` columns,
 * where `URL` is the per-company aggregator link. That link is a TRANSIENT
 * resolution input — we re-read it here, crawl it to derive the real domain +
 * website + careers/recruiting link, persist those on the row, and NEVER store
 * the aggregator URL. Companies whose crawl returns nothing are left as-is for
 * the recovery ladder.
 *
 * This shares the `recoverDomains` driver with `pnpm recover-domains`; the only
 * difference is the per-company output also surfaces the careers link and the
 * default CSV path, so the operator can run the full re-anchor in one command.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { parseCsv } from "../src/import/csv";
import { normalizeName, recoverDomains } from "../src/providers/recover-domains";

// tsx does not auto-load .env.local; do it for consistency (the crawl itself
// needs no API key, but the DB/provider stack expects the env loaded first).
loadEnvFile();

const DEFAULT_CSV = join(homedir(), "Downloads", "san-francisco-startups.csv");

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;

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

  const companies = createCompanyRepo(createDb(DB_URL));
  console.log(
    `Crawling aggregator pages from "${csvPath}" (${nameToAggregatorUrl.size} URLs)…`,
  );

  // The async libsql repo can't satisfy the sync `RecoverDomainsRepo` shape, so
  // pre-fetch the list and adapt `update` to delegate to the async repo.
  const all = await companies.list();
  const repo = {
    list: () => all,
    update: (id: number, patch: { domain: string; websiteUrl: string; recruitingWebsite?: string }) =>
      companies.update(id, patch),
  };

  let withCareers = 0;
  const result = await recoverDomains(repo, nameToAggregatorUrl, undefined, {
    onResult: (e) => {
      const id = `${e.company.name} (#${e.company.id})`;
      if (e.unmapped) return; // no aggregator URL for this company; stay quiet
      if (e.recovered) {
        const careers = e.recovered.recruitingUrl ?? "–";
        if (e.recovered.recruitingUrl) withCareers++;
        console.log(`✓ ${e.company.name} → ${e.recovered.domain} | careers: ${careers}`);
      } else if (e.collidedDomain) {
        console.log(`⚠ ${id} → ${e.collidedDomain} collision (already owned — skipped)`);
      } else {
        console.log(`· ${id} still unresolved`);
      }
    },
  });

  console.log(
    `Done — ${result.recovered} recovered, ${withCareers} with-careers, ` +
      `${result.unresolved} unresolved, ${result.collided} collided.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
