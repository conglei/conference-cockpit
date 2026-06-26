/**
 * CLI: discover roles and insert them as `roles` (the job-first funnel doorway).
 *
 * Two backends, selected with `--provider`:
 *
 *   # Broad Google-Jobs sweep (company-agnostic) — default
 *   pnpm find-jobs "founding engineer San Francisco"
 *   pnpm find-jobs "AI agents" --limit 20 --provider searchapi
 *
 *   # Company-scoped jobs — public ATS board preferred, LinkedIn as fallback
 *   pnpm find-jobs --provider harvest acme            # one company by slug
 *   pnpm find-jobs --provider harvest --funnel        # all funnel companies
 *   pnpm find-jobs --provider harvest acme "engineer" # optional query filter
 *   pnpm find-jobs --provider ats --funnel            # force ATS-only (no LinkedIn)
 *
 * In company-scoped mode each company prefers its free, uncapped public ATS
 * board (Ashby/Greenhouse/Lever/Workable) when `recruiting_website` names one,
 * else falls back to HarvestAPI LinkedIn by `linkedin_company_id` (read, and
 * lazily resolved + persisted if missing; `experienceLevel` defaults to
 * mid-senior). `--provider ats` forces ATS-only (no LinkedIn fallback). Roles
 * still insert via the existing dedupe(external_id) → insert flow.
 *
 * Provider keys come from .env.local (HARVESTAPI_KEY / SEARCHAPI_KEY); missing
 * keys degrade gracefully with an actionable note.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { COMPANY_STATUS } from "../src/db/schema";
import { detectAts } from "../src/providers/ats";
import { createProvider } from "../src/providers";
import { findJobs, findJobsForCompany, findJobsFromAts } from "../src/roles";

// tsx does not auto-load .env.local; do it before any provider is constructed.
loadEnvFile();

/** Funnel = companies past `new` but not `passed` (the ones we actively pursue). */
const FUNNEL_STATUSES = new Set<string>(
  COMPANY_STATUS.filter((s) => s !== "new" && s !== "passed"),
);

async function main() {
  const args = process.argv.slice(2);

  // --limit N
  let limit: number | undefined;
  const limitFlag = args.indexOf("--limit");
  if (limitFlag !== -1) {
    limit = Number(args[limitFlag + 1]);
    args.splice(limitFlag, 2);
  }

  // --provider harvest|searchapi (default searchapi to avoid surprises)
  let providerKind = "searchapi";
  const providerFlag = args.indexOf("--provider");
  if (providerFlag !== -1) {
    providerKind = (args[providerFlag + 1] ?? "").toLowerCase();
    args.splice(providerFlag, 2);
  }

  // --funnel selects all funnel companies (harvest mode only)
  let funnel = false;
  const funnelFlag = args.indexOf("--funnel");
  if (funnelFlag !== -1) {
    funnel = true;
    args.splice(funnelFlag, 1);
  }

  const db = createDb();
  const companies = createCompanyRepo(db);
  const roles = createRoleRepo(db);

  // Company-scoped mode: `harvest` (ATS-preferred, LinkedIn fallback) or `ats`
  // (ATS-only). Both select companies the same way; they differ only in whether
  // a non-ATS company falls back to the LinkedIn/companyId backend.
  if (providerKind === "harvest" || providerKind === "ats") {
    const atsOnly = providerKind === "ats";

    // A slug positional and/or --funnel selects companies; any remaining
    // positionals after the slug form the optional query filter (LinkedIn path).
    let targets;
    let query: string | undefined;
    if (funnel) {
      targets = (await companies.list()).filter((c) => FUNNEL_STATUSES.has(c.status));
      query = args.join(" ").trim() || undefined;
    } else {
      const slug = args[0];
      if (!slug) {
        console.error(
          `Usage: pnpm find-jobs --provider ${providerKind} <slug | --funnel> ["query"]`,
        );
        process.exit(1);
      }
      const company = await companies.getBySlug(slug);
      if (!company) {
        console.error(`No company found for slug: ${slug}.`);
        process.exit(1);
      }
      targets = [company];
      query = args.slice(1).join(" ").trim() || undefined;
    }

    // Construct the LinkedIn provider lazily — `ats`-only never needs it, so a
    // missing HarvestAPI key shouldn't block a pure-ATS run.
    let linkedinProvider: ReturnType<typeof createProvider> | undefined;
    const getLinkedinProvider = () => (linkedinProvider ??= createProvider("harvest"));

    console.log(
      `Searching jobs for ${targets.length} company(ies)` +
        (atsOnly ? " (ATS-only)" : " (ATS preferred, LinkedIn fallback)") +
        (query ? ` (query "${query}")` : "") +
        "…",
    );

    let totalInserted = 0;
    let totalDup = 0;
    let totalFiltered = 0;
    for (const company of targets) {
      const board = company.recruitingWebsite
        ? detectAts(company.recruitingWebsite)
        : undefined;

      if (board) {
        // Prefer the company's free, uncapped public ATS board.
        const r = await findJobsFromAts({ companies, roles }, company.id);
        printRun(`ats:${board.provider}`, company.name, r.inserted.length, r.filtered);
        for (const dup of r.duplicates) {
          console.log(`· dup      ${dup.title} (external_id=${dup.externalId}) — already tracked`);
        }
        for (const n of r.notes) console.log(`  ⚠ ${n}`);
        totalInserted += r.inserted.length;
        totalDup += r.duplicates.length;
        totalFiltered += r.filtered;
        continue;
      }

      if (atsOnly) {
        // No board and ATS-only → skip rather than fall back to LinkedIn.
        console.log(`[ats:none] ${company.name} → skipped (no public ATS board)`);
        continue;
      }

      // Fall back to HarvestAPI LinkedIn by companyId.
      const r = await findJobsForCompany(
        { provider: getLinkedinProvider(), companies, roles },
        company.id,
        { limit, query },
      );
      if (r.resolvedCompanyId) {
        console.log(`  ↳ resolved & saved linkedin_company_id for ${company.name}`);
      }
      printRun("linkedin", company.name, r.inserted.length, r.filtered);
      for (const dup of r.duplicates) {
        console.log(`· dup      ${dup.title} (external_id=${dup.externalId}) — already tracked`);
      }
      for (const n of r.notes) console.log(`  ⚠ ${n}`);
      totalInserted += r.inserted.length;
      totalDup += r.duplicates.length;
      totalFiltered += r.filtered;
    }

    console.log(
      `Done — ${totalInserted} new role(s), ${totalDup} duplicate(s), ` +
        `${totalFiltered} filtered (non-eng/junior) across ${targets.length} company(ies).`,
    );
    return;
  }

  const provider = createProvider(providerKind);

  // Broad Google-Jobs sweep (company-agnostic).
  const query = args.join(" ").trim();
  if (!query) {
    console.error('Usage: pnpm find-jobs "<search query>" [--limit N]');
    process.exit(1);
  }

  console.log(`Searching Google Jobs via provider "${provider.name}" for: ${query}`);

  const r = await findJobs({ provider, companies, roles }, query, { limit });

  for (const c of r.companiesCreated) {
    console.log(`+ company  ${c.name} (#${c.id}) [new/google_jobs]`);
  }
  for (const role of r.inserted) {
    const company = await companies.get(role.companyId);
    console.log(`+ role     ${role.title} @ ${company?.name ?? "?"} (#${role.id})`);
  }
  for (const dup of r.duplicates) {
    console.log(`· dup      ${dup.title} (external_id=${dup.externalId}) — already tracked`);
  }
  for (const n of r.notes) console.log(`  ⚠ ${n}`);

  console.log(
    `Done — ${r.inserted.length} new role(s), ${r.duplicates.length} duplicate(s), ` +
      `${r.filtered} filtered (non-eng/junior), ${r.companiesCreated.length} new company stub(s).`,
  );
}

/** Per-company one-liner naming the backend that ran, e.g. `[ats:ashby] Giga → 12 new, 31 filtered`. */
function printRun(backend: string, companyName: string, inserted: number, filtered: number) {
  console.log(`[${backend}] ${companyName} → ${inserted} new, ${filtered} filtered`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
