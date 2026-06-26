/**
 * The who-next ordering (issue 06).
 *
 * Given the people who can give a warm intro (`can_refer = true`), rank them so
 * the highest-value warm paths are always in front:
 *
 *     priority = companyFit (slice-05 score_overall on their company)
 *              × connectionStrength (closer degree ⇒ stronger)
 *
 * A 1st-degree contact at a top-fit company outranks a 2nd-degree contact at the
 * same company, which outranks anyone at a weaker-fit company. Companies that
 * aren't scored yet get a neutral mid fit so a hot warm path isn't buried just
 * because scoring hasn't run.
 *
 * Deterministic primitive (ADR-0002): pure read + sort, no judgment, no network.
 */

import type { CompanyRepo } from "../db/repository";
import type { PersonRepo } from "../db/people-repository";
import type { Company, Person } from "../db/schema";

export interface WhoNextEntry {
  person: Person;
  company?: Company;
  /** Company fit in [0,1] — slice-05 `score_overall`, or a neutral default. */
  companyFit: number;
  /** Connection strength in (0,1] derived from `connection_degree`. */
  connectionStrength: number;
  /** companyFit × connectionStrength — the sort key (desc). */
  priority: number;
}

/** Neutral fit for a contact whose company hasn't been scored yet. */
const DEFAULT_FIT = 0.5;

/**
 * Map a connection degree to a strength multiplier. 1st-degree is strongest;
 * each further degree is weaker. Unknown degree is treated as ~1st so we never
 * bury a flagged referrer just for missing the field.
 */
export function connectionStrength(degree: number | null | undefined): number {
  if (degree == null) return 1;
  if (degree <= 1) return 1;
  // 2nd-degree → 0.5, 3rd → 0.33, … (1 / degree).
  return 1 / degree;
}

/**
 * Rank contactable referrers by fit × connection-strength (desc). Stable
 * tie-break by person name so the ordering is deterministic for tests/UI.
 */
export async function whoNext(
  personRepo: PersonRepo,
  companyRepo: CompanyRepo,
): Promise<WhoNextEntry[]> {
  const referrers = await personRepo.listReferrers();

  // Resolve each referrer's company once (small N; cache by id).
  const companyCache = new Map<number, Company | undefined>();
  const getCompany = async (id: number | null): Promise<Company | undefined> => {
    if (id == null) return undefined;
    if (!companyCache.has(id)) companyCache.set(id, await companyRepo.get(id));
    return companyCache.get(id);
  };

  const entries: WhoNextEntry[] = await Promise.all(
    referrers.map(async (person) => {
      const company = await getCompany(person.companyId);
      const companyFit = company?.scoreOverall ?? DEFAULT_FIT;
      const strength = connectionStrength(person.connectionDegree);
      return {
        person,
        company,
        companyFit,
        connectionStrength: strength,
        priority: companyFit * strength,
      };
    }),
  );

  entries.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.person.name.localeCompare(b.person.name),
  );
  return entries;
}
