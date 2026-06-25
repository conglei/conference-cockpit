import { getDb } from "@/db/client";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import RolesTable, { type RoleRow } from "../_components/RolesTable";
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
  const sortKey: RoleSortKey = isSortKey(sort) ? sort : "posted";
  const sortDir: SortDir = dir === "asc" ? "asc" : "desc";

  const db = getDb();
  const roleRepo = createRoleRepo(db);
  const companyRepo = createCompanyRepo(db);

  // Fetch the FULL dataset (all statuses); filtering happens client-side.
  const roles = roleRepo.list();
  // Resolve each role's company link via the data layer (no raw SQL), then
  // flatten name/status/slug onto each row so the client can render + sort by it.
  const companyById = new Map(
    [...new Set(roles.map((r) => r.companyId))]
      .map((id) => companyRepo.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => [c.id, c] as const),
  );

  const rows: RoleRow[] = roles.map((r) => {
    const company = companyById.get(r.companyId);
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      location: r.location,
      postedDate: r.postedDate,
      status: r.status,
      source: r.source,
      companyName: company?.name ?? null,
      companyStatus: company?.status ?? null,
    };
  });

  return (
    <main>
      <h1>Roles</h1>
      <p className="subtitle">{rows.length} roles discovered (job-first entry)</p>

      <RolesTable
        roles={rows}
        initialStatus={status}
        initialSort={sortKey}
        initialDir={sortDir}
      />
    </main>
  );
}
