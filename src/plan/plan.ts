/**
 * The plan orchestrator (product-design.md §11 Phase 2): score every company
 * through the chosen lens, rank, take the top N, and shape each into the
 * company-first output unit. Pure over an in-memory `PlanGraph` so it is fully
 * unit-testable; `loadGraph` adapts the DB repos into that graph.
 */
import type { DB } from "../db/client";
import { createCompanyRepo, createRoleRepo } from "../db/repository";
import { createPersonRepo } from "../db/people-repository";
import { createTalkRepo } from "../db/talk-repository";
import type {
  ConferencePlan,
  GoalProfile,
  Lens,
  PlanContext,
  PlanGraph,
} from "./types";

export const DEFAULT_PLAN_LIMIT = 8;

/**
 * True when any company in the graph carries a persisted taste score. When false
 * (a clean DB / fresh clone), the lens switches to neutral public-facts ranking
 * so the demo still produces a plan instead of an empty one.
 */
export function graphHasScores(graph: PlanGraph): boolean {
  return graph.companies.some(
    (c) =>
      c.scoreOverall != null ||
      c.scoreFounderQuality != null ||
      c.scoreInvestorQuality != null ||
      c.scoreDomainFit != null ||
      c.scoreStageFit != null ||
      c.scoreSizeFit != null,
  );
}

export function buildPlan(input: {
  lens: Lens;
  profile: GoalProfile;
  graph: PlanGraph;
  now?: Date;
  limit?: number;
}): ConferencePlan {
  const now = input.now ?? new Date();
  const ctx: PlanContext = {
    profile: input.profile,
    graph: input.graph,
    now,
    neutralMode: !graphHasScores(input.graph),
  };

  const scored = input.graph.companies
    .map((c) => ({ company: c, score: input.lens.scoreCompany(c, ctx) }))
    .filter((x) => x.score.score > 0)
    .sort((a, b) => b.score.score - a.score.score);

  const top = scored.slice(0, input.limit ?? DEFAULT_PLAN_LIMIT);
  const companies = top.map((x, i) =>
    input.lens.buildPlanned(x.company, x.score, i + 1, ctx),
  );

  return {
    lens: input.lens.key,
    generatedAt: now.getTime(),
    consideredCompanies: scored.length,
    companies,
  };
}

/** Adapt the DB repositories into the read-only PlanGraph the lens composes over. */
export async function loadGraph(db: DB): Promise<PlanGraph> {
  const companies = createCompanyRepo(db);
  const roles = createRoleRepo(db);
  const people = createPersonRepo(db);
  const talks = createTalkRepo(db);

  // Pre-fetch everything once and group into in-memory indexes so the
  // PlanGraph's synchronous lookup callbacks stay synchronous (the lens scoring
  // is pure/sync). The data layer is async now, so the awaiting happens here.
  const [allCompanies, allRoles, allPeople, allTalks] = await Promise.all([
    companies.list(),
    roles.list(),
    people.list(),
    talks.list(),
  ]);

  const rolesByCompanyId = groupBy(allRoles, (r) => r.companyId);
  const peopleByCompanyId = groupBy(
    allPeople.filter((p) => p.companyId != null),
    (p) => p.companyId as number,
  );
  const talksBySpeakerId = groupBy(allTalks, (t) => t.speakerId);

  return {
    companies: allCompanies,
    rolesByCompany: (companyId) => rolesByCompanyId.get(companyId) ?? [],
    peopleByCompany: (companyId) => peopleByCompanyId.get(companyId) ?? [],
    talksBySpeaker: (speakerId) => talksBySpeakerId.get(speakerId) ?? [],
  };
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
