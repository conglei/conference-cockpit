/**
 * CLI: referrer discovery & who-next (issue 06). Thin deterministic primitives;
 * the judgment lives in the `find-referrers` SKILL.
 *
 *   # 1. Ingest your downloaded LinkedIn connections export (1st-degree graph)
 *   pnpm find-referrers ingest path/to/Connections.csv
 *
 *   # 2. Cross-reference a target company's roster → flag warm-intro referrers
 *   pnpm find-referrers cross-ref <company-slug> [--limit N]
 *   pnpm find-referrers cross-ref --all          # every resolved company
 *
 *   # 3. Print the who-next ranking (fit × connection-strength)
 *   pnpm find-referrers who-next
 *
 * Provider selection is config, not code: ENRICHMENT_PROVIDER=fake|harvest in
 * .env.local (defaults to fake, which is offline). The roster comes from
 * `provider.getEmployees` (HarvestAPI for real).
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createProvider } from "../src/providers";
import {
  LinkedinCsvSource,
  crossReferenceCompany,
  ingestConnections,
  whoNext,
} from "../src/referrers";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const db = createDb(DB_URL);
  const people = createPersonRepo(db);
  const companies = createCompanyRepo(db);

  if (cmd === "ingest") {
    const path = args[1];
    if (!path) {
      console.error("Usage: pnpm find-referrers ingest <connections.csv>");
      process.exit(1);
    }
    const source = new LinkedinCsvSource(readFileSync(path, "utf8"));
    const r = await ingestConnections(people, source);
    console.log(
      `Ingested via "${source.name}": ${r.inserted} new, ${r.updated} updated, ` +
        `${r.skipped} skipped.`,
    );
    return;
  }

  if (cmd === "cross-ref") {
    const provider = createProvider();
    const rest = args.slice(1);
    const limitFlag = rest.indexOf("--limit");
    let limit: number | undefined;
    if (limitFlag !== -1) {
      limit = Number(rest[limitFlag + 1]);
      rest.splice(limitFlag, 2);
    }
    const all = rest.includes("--all");
    const slug = all ? undefined : rest[0];

    if (!all && !slug) {
      console.error(
        "Usage: pnpm find-referrers cross-ref <company-slug> [--limit N] | --all",
      );
      process.exit(1);
    }

    const targets = all
      ? (await companies.list()).filter((c) => c.linkedinUrl)
      : [await companies.getBySlug(slug!)].filter((c): c is NonNullable<typeof c> => !!c);

    if (!all && targets.length === 0) {
      console.error(`No company with slug "${slug}".`);
      process.exit(1);
    }

    let total = 0;
    for (const company of targets) {
      const r = await crossReferenceCompany(companies, people, provider, company, {
        limit,
      });
      total += r.referrers.length;
      console.log(
        `· ${company.name} (#${company.id}) — roster ${r.rosterSize}, ` +
          `${r.referrers.length} referrer(s):`,
      );
      for (const p of r.referrers) {
        console.log(`    ✓ ${p.name}${p.title ? ` — ${p.title}` : ""} [can_refer]`);
      }
    }
    console.log(`Done — flagged ${total} referrer(s) across ${targets.length} company(ies).`);
    return;
  }

  if (cmd === "who-next" || cmd === undefined) {
    const entries = await whoNext(people, companies);
    if (entries.length === 0) {
      console.log("No contactable referrers yet. Ingest connections + cross-ref first.");
      return;
    }
    console.log("Who-next — warm paths ranked by fit × connection-strength:");
    for (const e of entries) {
      console.log(
        `  ${e.priority.toFixed(2)}  ${e.person.name}` +
          `${e.company ? ` @ ${e.company.name}` : ""}` +
          `  (fit ${e.companyFit.toFixed(2)} × deg ${e.person.connectionDegree ?? "?"})`,
      );
    }
    return;
  }

  console.error(`Unknown command "${cmd}". Use: ingest | cross-ref | who-next`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
