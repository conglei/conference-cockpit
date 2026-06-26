/**
 * CLI: list the `enriched` companies that still have **zero founder people
 * rows** — the residual the automatic recovery ladder could not recover
 * founders for (crawl → Apollo/HarvestAPI → web-search all came up empty).
 *
 *   pnpm needs-founders
 *
 * These are the candidates for the **browser rung** (ADR-0003 §2, rung 4): a
 * human-in-the-loop Claude-in-Chrome pass that opens the company's team/about
 * page or LinkedIn and extracts founders. See the `recover-founders-browser`
 * skill for the interactive workflow. This CLI only *surfaces* the queue; it
 * does no browser automation.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { needsFounders } from "../src/enrich/needs-founders";
import type { Person } from "../src/db/schema";

// tsx does not auto-load .env.local; do it before touching the DB.
loadEnvFile();

async function main() {
  const db = createDb();
  const companyRepo = createCompanyRepo(db);
  const peopleRepo = createPersonRepo(db);

  const companies = await companyRepo.list();

  // Build companyId → people map so the selection stays a pure, testable helper.
  const peopleByCompany = new Map<number, Person[]>();
  for (const c of companies) {
    peopleByCompany.set(c.id, await peopleRepo.listByCompany(c.id));
  }

  const candidates = needsFounders(companies, peopleByCompany);

  if (candidates.length === 0) {
    console.log("No companies need a browser founder pass — every enriched company has a founder.");
    return;
  }

  console.log(
    `${candidates.length} enriched compan${candidates.length === 1 ? "y" : "ies"} with no founder rows (browser-rung candidates):`,
  );
  for (const c of candidates) {
    console.log(`· ${c.name} (#${c.id}, ${c.slug})`);
    console.log(`    domain:  ${c.domain ?? "—"}`);
    console.log(`    website: ${c.websiteUrl ?? "—"}`);
  }
}

await main();
