import { getDb } from "@/db/client";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import { roleProvenance, formatChip, isThin } from "@/provenance";
import RolesExplorer, { type RoleRow } from "../_components/RolesTable";
import { ROLE_SORT_KEYS, type RoleSortKey, type SortDir } from "@/ui/table-sort";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function isSortKey(v: string | undefined): v is RoleSortKey {
  return !!v && (ROLE_SORT_KEYS as readonly string[]).includes(v);
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    workType?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const status = sp.status ?? "all";
  const workType = sp.workType ?? "all";
  const sortKey: RoleSortKey = isSortKey(sp.sort) ? sp.sort : "posted";
  const sortDir: SortDir = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page) || 1);

  const db = getDb();
  const roleRepo = createRoleRepo(db);
  const companyRepo = createCompanyRepo(db);
  const now = new Date();

  // Filter + search + sort + paginate AT THE DB — one small page per request,
  // not the whole ~4.6k-role dataset. Three light queries run in parallel.
  const [{ rows: pageRows, total }, workTypes, anyScored] = await Promise.all([
    roleRepo.listRolesPage({
      status,
      workType,
      q,
      sort: sortKey,
      dir: sortDir,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    roleRepo.roleWorkTypes(),
    companyRepo.anyScored(),
  ]);

  const rows: RoleRow[] = pageRows.map((r) => {
    const prov = roleProvenance(r, now);
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      location: r.location,
      workType: r.workType,
      salary: r.salary,
      postedDate: r.postedDate,
      status: r.status,
      source: r.source,
      postedChip: formatChip(prov, now),
      postedThin: isThin(prov, now),
      companyName: r.companyName,
      companySlug: r.companySlug,
      companyScore: r.companyScore != null ? Math.round(r.companyScore * 100) : null,
    };
  });

  const filtered = q !== "" || status !== "all" || workType !== "all";

  return (
    <main>
      <p className="subtitle">
        <a href="/">← The plan</a>
      </p>
      <h1>Open roles</h1>
      <p className="subtitle">
        {total.toLocaleString()} {filtered ? "matching " : ""}roles — newest first, every posting dated.
      </p>

      <RolesExplorer
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        status={status}
        workType={workType}
        workTypes={workTypes}
        sort={sortKey}
        dir={sortDir}
        anyScored={anyScored}
      />
    </main>
  );
}
