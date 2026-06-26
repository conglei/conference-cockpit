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
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { detectAts, fetchAtsJobs } from "../src/providers/ats";
import { createProvider } from "../src/providers";
import {
  discoverAtsBoardUrl,
  gatherBoardCandidates,
  type BoardCandidate,
} from "../src/roles/ats-discovery";
import { isEngineeringOrProductRole } from "../src/roles/role-relevance";
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

// A board returning more than HIGH_VOLUME openings is a scaled enterprise (or a
// token-collision false match). Per user guidance we keep ONLY engineering +
// product for those, so the list isn't flooded with every function. Smaller
// boards (an early-stage target) keep all functions. Every company is then
// capped at PER_COMPANY_CAP newest roles as a backstop against any one board
// dominating the explorer / snapshot.
const HIGH_VOLUME = 60;
const PER_COMPANY_CAP = 80;

/** Newest-first by postedDate; undated roles sort last (stable-ish for ties). */
function byNewest(a: JobSearchResult, b: JobSearchResult): number {
  return (b.postedDate ?? "").localeCompare(a.postedDate ?? "");
}

/**
 * Pick which of a board's openings to keep: high-volume boards → engineering +
 * product only; then cap to the newest PER_COMPANY_CAP. Returns the survivors.
 */
function selectAtsJobs(jobs: JobSearchResult[]): JobSearchResult[] {
  const gated =
    jobs.length > HIGH_VOLUME ? jobs.filter((j) => j.title && isEngineeringOrProductRole(j.title)) : jobs;
  return [...gated].sort(byNewest).slice(0, PER_COMPANY_CAP);
}

/** Replace a company's roles with a fresh ATS pull (filtered + capped, see selectAtsJobs). */
async function replaceWithAts(
  roles: RoleRepo,
  companyId: number,
  existingIds: number[],
  jobs: JobSearchResult[],
): Promise<number> {
  for (const id of existingIds) await roles.delete(id);
  let inserted = 0;
  const seen = new Set<string>();
  for (const j of selectAtsJobs(jobs)) {
    if (!j.title) continue;
    if (j.externalId) {
      if (seen.has(j.externalId)) continue;
      seen.add(j.externalId);
      // external_id is GLOBALLY unique. A duplicate company row (e.g. "Arize" and
      // "Arize AI" both resolving to the same board) would otherwise crash the
      // insert — skip a job another company already owns rather than steal it.
      const owner = await roles.findByExternalId(j.externalId);
      if (owner && owner.companyId !== companyId) continue;
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

/** Build the per-company role-URL + role-id indexes used by discovery + replace. */
async function indexRoles(roles: RoleRepo) {
  const allRoles = await roles.list();
  const urlsByCo = new Map<number, string[]>();
  const idsByCo = new Map<number, number[]>();
  const atsSourced = new Set<number>();
  for (const r of allRoles) {
    if (r.url) (urlsByCo.get(r.companyId) ?? urlsByCo.set(r.companyId, []).get(r.companyId)!).push(r.url);
    (idsByCo.get(r.companyId) ?? idsByCo.set(r.companyId, []).get(r.companyId)!).push(r.id);
    if (r.source === "ats") atsSourced.add(r.companyId);
  }
  return { urlsByCo, idsByCo, atsSourced };
}

/** A company's web-search candidates, written out for the agent to adjudicate. */
interface ReviewEntry {
  slug: string;
  name: string;
  domain: string | null;
  description: string | null;
  candidates: BoardCandidate[];
}

/**
 * MODE 1 — gather. Auto-apply the TRUSTED tiers (existing board URL / probe with
 * identity). For every company that falls through to web search, collect its
 * board candidates to `--gather <file>` for the agent (judge-boards skill) to
 * decide, rather than guessing. Web search is NEVER auto-applied in this mode.
 */
async function runRefresh() {
  const dryRun = has("dry-run");
  const doWebsearch = !has("no-websearch");
  const doLinkedin = !has("no-linkedin");
  const missingOnly = has("missing-only");
  const linkedinOnly = has("linkedin-only"); // skip ATS discovery, go straight to LinkedIn
  const skipLarge = has("skip-large"); // exclude scaled enterprises (size_band=large)
  const gatherOut = has("gather") ? argFlag("gather") ?? "data/board-review.json" : undefined;
  const limit = Number(argFlag("limit")) || undefined;
  const only = argFlag("only");

  const db = createDb();
  const companies = createCompanyRepo(db);
  const roles = createRoleRepo(db);
  const searchProvider = doWebsearch ? createProvider("searchapi") : undefined;
  let harvest: ReturnType<typeof createProvider> | undefined;
  const getHarvest = () => (harvest ??= createProvider("harvest"));

  let all = await companies.list();
  if (only) {
    const set = new Set(only.split(",").map((s) => s.trim()).filter(Boolean));
    all = all.filter((c) => set.has(c.slug));
  }
  if (limit) all = all.slice(0, limit);

  const { urlsByCo, idsByCo, atsSourced } = await indexRoles(roles);
  if (missingOnly) all = all.filter((c) => !atsSourced.has(c.id));
  if (skipLarge) all = all.filter((c) => c.sizeBand !== "large");

  const tally = { ats: 0, gathered: 0, linkedin: 0, none: 0, rolesInserted: 0 };
  const byVia: Record<string, number> = {};
  const review: ReviewEntry[] = [];

  let idx = 0;
  async function worker() {
    while (idx < all.length) {
      const c: Company = all[idx++];
      const input = {
        name: c.name,
        slug: c.slug,
        domain: c.domain,
        recruitingWebsite: c.recruitingWebsite,
        roleUrls: urlsByCo.get(c.id),
      };
      try {
        // Trusted tiers only (omit searchProvider → cascade stops before web search).
        // Skipped entirely in --linkedin-only mode (the ATS pass already ran).
        const found = linkedinOnly ? undefined : await discoverAtsBoardUrl(input);
        if (found) {
          byVia[found.via] = (byVia[found.via] ?? 0) + 1;
          tally.ats++;
          if (!dryRun) {
            await companies.update(c.id, { recruitingWebsite: found.url });
            tally.rolesInserted += await replaceWithAts(roles, c.id, idsByCo.get(c.id) ?? [], found.jobs);
          }
          const kept = selectAtsJobs(found.jobs).length;
          console.log(
            `✓ ${c.name} → ats[${found.board.provider}:${found.board.token}] (${found.jobs.length}→${kept}) via ${found.via}`,
          );
          continue;
        }

        // No trusted board → gather web-search candidates for the agent to judge.
        if (!linkedinOnly && gatherOut && searchProvider) {
          const candidates = await gatherBoardCandidates(input, { searchProvider });
          if (candidates.length) {
            review.push({
              slug: c.slug,
              name: c.name,
              domain: c.domain,
              description: c.description ? c.description.slice(0, 280) : null,
              candidates,
            });
            tally.gathered++;
            const m = candidates.filter((x) => x.identity === "match").length;
            console.log(`? ${c.name} → ${candidates.length} candidate(s) [${m} match] → review`);
            continue;
          }
        }

        if (doLinkedin && (c.linkedinCompanyId || c.linkedinUrl)) {
          if (!dryRun) {
            // Insert LinkedIn jobs FIRST, then drop the old (stale Apollo) roles
            // ONLY if we got something — never empty a company for nothing.
            const r = await findJobsForCompany({ provider: getHarvest(), companies, roles }, c.id);
            if (r.inserted.length > 0) {
              const freshIds = new Set(r.inserted.map((role) => role.id));
              for (const id of idsByCo.get(c.id) ?? []) if (!freshIds.has(id)) await roles.delete(id);
              tally.linkedin++;
              tally.rolesInserted += r.inserted.length;
            }
            console.log(
              `${r.inserted.length > 0 ? "✓" : "·"} ${c.name} → linkedin (${r.inserted.length} new, ` +
                `${r.filtered} filtered${r.inserted.length === 0 ? ", kept existing" : ""})`,
            );
          } else {
            console.log(`· ${c.name} → would try LinkedIn`);
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

  if (gatherOut) {
    review.sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(gatherOut, JSON.stringify({ companies: review }, null, 2));
    console.log(`\nWrote ${review.length} companies needing review → ${gatherOut}`);
  }
  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Done — ATS: ${tally.ats}, gathered: ${tally.gathered}, ` +
      `LinkedIn: ${tally.linkedin}, none: ${tally.none} (of ${all.length}). Via: ${JSON.stringify(byVia)}.` +
      (dryRun ? "" : ` Inserted ${tally.rolesInserted} fresh role(s).`),
  );
}

/**
 * MODE 2 — apply the agent's decisions. Reads `{ decisions: [{slug, url, reason}] }`
 * (url null = "no real board, leave as-is"). For each chosen board, fetch + replace
 * that company's roles and persist the board as its recruiting_website.
 */
async function applyDecisions(file: string) {
  const dryRun = has("dry-run");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    decisions: { slug: string; url: string | null; reason?: string }[];
  };
  const db = createDb();
  const companies = createCompanyRepo(db);
  const roles = createRoleRepo(db);
  const { idsByCo } = await indexRoles(roles);

  let applied = 0;
  let inserted = 0;
  for (const d of parsed.decisions) {
    if (!d.url) {
      console.log(`· ${d.slug} → no board (${d.reason ?? "agent: none"})`);
      continue;
    }
    const company = await companies.getBySlug(d.slug);
    if (!company) {
      console.error(`! ${d.slug} → unknown slug`);
      continue;
    }
    const board = detectAts(d.url);
    if (!board) {
      console.error(`! ${d.slug} → ${d.url} is not a recognized ATS board`);
      continue;
    }
    const jobs = await fetchAtsJobs(d.url);
    if (jobs.length === 0) {
      console.error(`! ${d.slug} → ${d.url} returned 0 jobs (skipped)`);
      continue;
    }
    const kept = selectAtsJobs(jobs).length;
    if (!dryRun) {
      await companies.update(company.id, { recruitingWebsite: d.url });
      inserted += await replaceWithAts(roles, company.id, idsByCo.get(company.id) ?? [], jobs);
    }
    applied++;
    console.log(`✓ ${d.slug} → ats[${board.provider}:${board.token}] (${jobs.length}→${kept})`);
  }
  console.log(`\n${dryRun ? "[dry-run] " : ""}Applied ${applied} board(s), inserted ${inserted} role(s).`);
}

async function main() {
  const decisionsIn = argFlag("apply-decisions");
  if (decisionsIn) return applyDecisions(decisionsIn);
  return runRefresh();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
