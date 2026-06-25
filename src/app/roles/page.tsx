import { getDb } from "@/db/client";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import { roleProvenance, formatChip, isThin } from "@/provenance";
import RolesExplorer, { type RoleRow } from "../_components/RolesTable";
import { ROLE_SORT_KEYS, type RoleSortKey, type SortDir } from "@/ui/table-sort";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

function isSortKey(v: string | undefined): v is RoleSortKey {
  return !!v && (ROLE_SORT_KEYS as readonly string[]).includes(v);
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; dir?: string }>;
}) {
  const { status, sort, dir } = await searchParams;
  // Default sort is company fit — the decision axis for a company-first lens.
  const sortKey: RoleSortKey = isSortKey(sort) ? sort : "fit";
  const sortDir: SortDir = dir === "asc" ? "asc" : "desc";

  const db = getDb();
  const roleRepo = createRoleRepo(db);
  const companyRepo = createCompanyRepo(db);
  const now = new Date();

  // Fetch the FULL dataset (all statuses); filtering happens client-side.
  const roles = roleRepo.list();
  // Resolve each role's company once, then flatten name/slug/score/status onto
  // each row so the client can render + rank by company fit without a DB call.
  const companyById = new Map(
    [...new Set(roles.map((r) => r.companyId))]
      .map((id) => companyRepo.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => [c.id, c] as const),
  );

  const rows: RoleRow[] = roles.map((r) => {
    const company = companyById.get(r.companyId);
    const prov = roleProvenance(r, now);
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      location: r.location,
      workType: r.workType,
      salary: r.salary,
      description: r.description,
      postedDate: r.postedDate,
      status: r.status,
      source: r.source,
      postedChip: formatChip(prov, now),
      postedThin: isThin(prov, now),
      companyName: company?.name ?? null,
      companySlug: company?.slug ?? null,
      companyScore:
        company?.scoreOverall != null
          ? Math.round(company.scoreOverall * 100)
          : null,
    };
  });

  return (
    <main>
      <p className="subtitle">
        <a href="/">← The plan</a>
      </p>
      <h1>Open roles</h1>
      <p className="subtitle">
        {rows.length} roles across your target companies — ranked by company fit,
        every posting dated.
      </p>

      <RolesExplorer
        roles={rows}
        initialStatus={status}
        initialSort={sortKey}
        initialDir={sortDir}
      />
    </main>
  );
}
