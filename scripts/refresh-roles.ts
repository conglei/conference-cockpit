/**
 * CLI: refresh `roles` from each company's LIVE source instead of a stale
 * aggregator. Per company, cheapest-first:
 *
 *   1–3. discover the public ATS board (existing role URLs → probe) and pull
 *        ALL current openings (free, no key) — replaces that company's old roles.
 *   4.   if no board, WEB SEARCH for it (SearchAPI, paid) — unless --no-websearch.
 *   5.   if still none, LinkedIn jobs via HarvestAPI (paid) — unless --no-linkedin.
 *
 * A company with NO live source found keeps its existing roles (no regression).
 *
 *   pnpm refresh-roles --dry-run                 # report coverage, write nothing
 *   pnpm refresh-roles --dry-run --no-websearch --no-linkedin   # FREE ATS-only preview
 *   pnpm refresh-roles                            # do it (ATS free; web/LinkedIn paid)
 *   pnpm refresh-roles --only resolve-ai          # one company
 *   pnpm refresh-roles --limit 50
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { fetchAtsJobs } from "../src/providers/ats";
import { createProvider } from "../src/providers";
import { discoverAtsBoardUrl } from "../src/roles/ats-discovery";
import { findJobsForCompany } from "../src/roles";
import type { JobSearchResult } from "../src/providers/types";
import type { RoleRepo } from "../src/db/repository";
import type { Company } from "../src/db/schema";

loadEnvFile();

const argFlag = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string): boolean => process.argv.includes(`--${n}`);

function inferWorkType(loc: string | undefined): "remote" | "hybrid" | null {
  const s = (loc ?? "").toLowerCase();
  if (/\bremote\b/.test(s)) return "remote";
  if (/\bhybrid\b/.test(s)) return "hybrid";
  return null;
}

/** Replace a company's roles with a fresh ATS pull (ALL openings, no eng filter). */
async function replaceWithAts(
  roles: RoleRepo,
  companyId: number,
  existingIds: number[],
  jobs: JobSearchResult[],
): Promise<number> {
  for (const id of existingIds) await roles.delete(id);
  let inserted = 0;
  const seen = new Set<string>();
  for (const j of jobs) {
    if (!j.title) continue;
    if (j.externalId) {
      if (seen.has(j.externalId)) continue;
      seen.add(j.externalId);
    }
    await roles.create({
      companyId,
      title: j.title,
      url: j.link ?? null,
      location: j.location ?? null,
      workType: inferWorkType(j.location),
      description: j.description ?? null,
      postedDate: j.postedDate ?? null,
      status: "new",
      source: "ats",
      externalId: j.externalId ?? null,
      lastSeenAt: new Date().toISOString(),
    });
    inserted++;
  }
  return inserted;
}

async function main() {
  const dryRun = has("dry-run");
  const doWebsearch = !has("no-websearch");
  const doLinkedin = !has("no-linkedin");
  const missingOnly = has("missing-only"); // skip companies already refreshed to ATS
  const limit = Number(argFlag("limit")) || undefined;
  const only = argFlag("only");

  const db = createDb();
  const companies = createCompanyRepo(db);
  const roles = createRoleRepo(db);

  const searchProvider = doWebsearch ? createProvider("searchapi") : undefined;
  let harvest: ReturnType<typeof createProvider> | undefined;
  const getHarvest = () => (harvest ??= createProvider("harvest"));

  let all = await companies.list();
  if (only) all = all.filter((c) => c.slug === only);
  if (limit) all = all.slice(0, limit);

  // Existing role URLs + ids per company (for discovery + replacement).
  const allRoles = await roles.list();
  const urlsByCo = new Map<number, string[]>();
  const idsByCo = new Map<number, number[]>();
  const atsSourced = new Set<number>(); // companies already refreshed to ATS
  for (const r of allRoles) {
    if (r.url) (urlsByCo.get(r.companyId) ?? urlsByCo.set(r.companyId, []).get(r.companyId)!).push(r.url);
    (idsByCo.get(r.companyId) ?? idsByCo.set(r.companyId, []).get(r.companyId)!).push(r.id);
    if (r.source === "ats") atsSourced.add(r.companyId);
  }
  if (missingOnly) all = all.filter((c) => !atsSourced.has(c.id));

  const tally = { ats: 0, websearch: 0, linkedin: 0, none: 0, rolesInserted: 0 };
  const byVia: Record<string, number> = {};

  let idx = 0;
  async function worker() {
    while (idx < all.length) {
      const c: Company = all[idx++];
      try {
        const found = await discoverAtsBoardUrl(
          {
            name: c.name,
            slug: c.slug,
            domain: c.domain,
            recruitingWebsite: c.recruitingWebsite,
            roleUrls: urlsByCo.get(c.id),
          },
          { searchProvider },
        );

        if (found) {
          const jobs = await fetchAtsJobs(found.url);
          byVia[found.via] = (byVia[found.via] ?? 0) + 1;
          if (found.via === "web-search") tally.websearch++;
          else tally.ats++;
          if (!dryRun && jobs.length > 0) {
            await companies.update(c.id, { recruitingWebsite: found.url });
            const n = await replaceWithAts(roles, c.id, idsByCo.get(c.id) ?? [], jobs);
            tally.rolesInserted += n;
          }
          console.log(`✓ ${c.name} → ats[${found.board.provider}:${found.board.token}] (${jobs.length}) via ${found.via}`);
          continue;
        }

        if (doLinkedin && (c.linkedinCompanyId || c.linkedinUrl)) {
          tally.linkedin++;
          if (!dryRun) {
            for (const id of idsByCo.get(c.id) ?? []) await roles.delete(id);
            const r = await findJobsForCompany({ provider: getHarvest(), companies, roles }, c.id);
            tally.rolesInserted += r.inserted.length;
            console.log(`✓ ${c.name} → linkedin (${r.inserted.length} new, ${r.filtered} filtered)`);
          } else {
            console.log(`· ${c.name} → would try LinkedIn (has ${c.linkedinCompanyId ? "companyId" : "linkedin_url"})`);
          }
          continue;
        }

        tally.none++;
        console.log(`· ${c.name} → no live source (kept ${idsByCo.get(c.id)?.length ?? 0} existing)`);
      } catch (err) {
        console.error(`! ${c.name} → ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done — ATS: ${tally.ats}, web-search: ${tally.websearch}, ` +
      `LinkedIn: ${tally.linkedin}, none: ${tally.none} (of ${all.length}). ` +
      `Via: ${JSON.stringify(byVia)}.` +
      (dryRun ? "" : ` Inserted ${tally.rolesInserted} fresh role(s).`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
