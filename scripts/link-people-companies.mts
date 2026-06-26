/**
 * Link people to company rows by matching their `current_company` text to a
 * company name (normalized). Only fills a NULL company_id — never repoints an
 * existing link. Idempotent; safe on local or Turso.
 *
 *   pnpm tsx scripts/link-people-companies.mts [--dry-run]
 */
import { loadEnvFile } from "../src/onboarding/load-env";
loadEnvFile();
import { createDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";

const dry = process.argv.includes("--dry-run");
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").trim();

const db = createDb();
const companies = createCompanyRepo(db);
const people = createPersonRepo(db);

const byName = new Map((await companies.list()).map((c) => [norm(c.name), c.id]));
const unlinked = (await people.list()).filter((p) => p.companyId == null && p.currentCompany);

let linked = 0;
for (const p of unlinked) {
  const cid = byName.get(norm(p.currentCompany));
  if (!cid) continue;
  linked++;
  if (!dry) await people.update(p.id, { companyId: cid });
}
console.log(`${dry ? "[dry-run] " : ""}Linked ${linked} people to a company by name.`);
