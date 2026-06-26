/**
 * Marking a role interesting is the convergence point of the dual-entry funnel
 * (issue 07 / ADR-0001): it back-fills the role's status AND promotes its
 * company into the funnel (`new` → at least `interesting`). A job discovered via
 * find-jobs created its company as an unenriched `new` stub; expressing interest
 * in the role is what pulls that company into the company-first pipeline
 * (resolve → enrich → score).
 */
import type { CompanyRepo, RoleRepo } from "../db/repository";
import type { Company, Role } from "../db/schema";

export interface MarkRoleInterestingResult {
  role: Role;
  /** The role's company after promotion. */
  company: Company;
  /** True if the company actually advanced in the funnel this call. */
  companyPromoted: boolean;
}

/**
 * Mark a role `interesting` and promote its company at least to `interesting`.
 * Idempotent: re-marking an already-interesting role / already-advanced company
 * is a no-op that never regresses a company further along the funnel.
 */
export async function markRoleInteresting(
  deps: { roles: RoleRepo; companies: CompanyRepo },
  roleId: number,
): Promise<MarkRoleInterestingResult> {
  const { roles, companies } = deps;

  const existing = await roles.get(roleId);
  if (!existing) throw new Error(`markRoleInteresting: no role with id ${roleId}`);

  const role =
    existing.status === "interesting"
      ? existing
      : ((await roles.update(roleId, { status: "interesting" })) ?? existing);

  const before = await companies.get(role.companyId);
  if (!before) throw new Error(`markRoleInteresting: role #${roleId} has no company`);

  const company = (await companies.promoteToAtLeast(role.companyId, "interesting")) ?? before;
  const companyPromoted = company.status !== before.status;

  return { role, company, companyPromoted };
}
