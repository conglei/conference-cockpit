import { getDb } from "@/db/client";
import { cleanText } from "@/db/columns";
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
  // Default sort is recency — neutral and useful with or without taste scores.
  // (Company fit is a bonus axis, offered only when scores exist.)
  const sortKey: RoleSortKey = isSortKey(sort) ? sort : "posted";
  const sortDir: SortDir = dir === "asc" ? "asc" : "desc";

  const db = getDb();
  const roleRepo = createRoleRepo(db);
  const companyRepo = createCompanyRepo(db);
  const now = new Date();

  // Fetch the FULL dataset (all statuses); filtering happens client-side.
  // Two queries total: all roles + all companies. (Previously this did one
  // `companyRepo.get(id)` PER company — ~250 sequential round-trips, which is
  // brutally slow over a remote Turso DB.)
  const [roles, allCompanies] = await Promise.all([roleRepo.listForCards(), companyRepo.list()]);
  const companyById = new Map(allCompanies.map((c) => [c.id, c] as const));

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
      description: cleanText(r.description),
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
        {rows.length} roles across {new Set(rows.map((r) => r.companySlug).filter(Boolean)).size}{" "}
        companies — newest first, every posting dated.
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
