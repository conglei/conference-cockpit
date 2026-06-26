/**
 * Assemble the **per-company scoring context** the `score-companies` skill judges
 * over — firmographics + funding + founders-with-pedigree + open-role titles, in
 * ONE pass. This is the reusable version of the ad-hoc "dump" you'd otherwise
 * hand-write before ranking: the agent calls it once instead of N `get` lookups,
 * then reasons over the result and pipes its judgment to `score apply`.
 *
 * Pure over the repos (fully unit-testable); the `score context` CLI is a thin
 * adapter. The founder bar comes from the shared `founderPedigree` primitive, so
 * it stays consistent with the people ranker.
 */
import type { CompanyRepo, RoleRepo } from "../db/repository";
import type { PersonRepo } from "../db/people-repository";
import type { Person } from "../db/schema";
import { asList } from "../db/columns";
import { founderPedigree, isFounderTitle } from "./pedigree";

export interface ScoringContextCompany {
  slug: string;
  name: string;
  stage: string | null;
  location: string | null;
  domain: string | null;
  industry: string | null;
  verticals: string[];
  sizeBand: string | null;
  funding: { round: string | null; amount: string | null; total: string | null; lead: string | null };
  /** Founders with their founder-bar flags (e.g. ["ex-OpenAI","PhD/research"]). */
  founders: { name: string; title: string | null; pedigree: string[] }[];
  /** A sample of open-role titles (for domain / role-fit judgment). */
  openRoleTitles: string[];
  description: string | null;
}

export interface ScoringContextOptions {
  /** Restrict to companies whose verticals include this. */
  vertical?: string;
  /** Only companies with ≥1 open role. */
  hiringOnly?: boolean;
  limit?: number;
}

export interface ScoringContextRepos {
  companies: CompanyRepo;
  people: PersonRepo;
  roles: RoleRepo;
}

export async function buildScoringContext(
  repos: ScoringContextRepos,
  opts: ScoringContextOptions = {},
): Promise<ScoringContextCompany[]> {
  const [companies, people, roles] = await Promise.all([
    repos.companies.list(),
    repos.people.list(),
    repos.roles.list(),
  ]);

  const foundersByCo = groupBy(
    people.filter((p) => p.companyId != null && isFounderTitle(p.title, p.headline)),
    (p) => p.companyId as number,
  );
  const roleTitlesByCo = groupBy(roles, (r) => r.companyId);

  let rows = companies;
  if (opts.vertical) rows = rows.filter((c) => asList(c.verticals).includes(opts.vertical!));
  if (opts.hiringOnly) rows = rows.filter((c) => (roleTitlesByCo.get(c.id)?.length ?? 0) > 0);

  const out = rows.map((c): ScoringContextCompany => ({
    slug: c.slug,
    name: c.name,
    stage: c.stage,
    location: c.location,
    domain: c.domain,
    industry: c.industry,
    verticals: asList(c.verticals),
    sizeBand: c.sizeBand ?? (c.headcount != null ? String(c.headcount) : null),
    funding: { round: c.latestRound, amount: c.latestAmount, total: c.fundingTotal, lead: c.leadInvestor },
    founders: (foundersByCo.get(c.id) ?? []).slice(0, 4).map((p: Person) => ({
      name: p.name,
      title: p.title,
      pedigree: founderPedigree({
        workHistory: p.workHistory,
        education: p.education,
        headline: p.headline,
        currentName: p.currentCompany ?? c.name,
      }).flags,
    })),
    openRoleTitles: (roleTitlesByCo.get(c.id) ?? []).slice(0, 8).map((r) => r.title),
    description: c.description ? c.description.slice(0, 200) : null,
  }));

  return opts.limit ? out.slice(0, opts.limit) : out;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}
