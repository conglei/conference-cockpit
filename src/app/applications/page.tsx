import { getDb } from "@/db/client";
import { createApplicationRepo } from "@/db/applications-repository";
import ApplicationsTable, {
  type ApplicationRow,
} from "../_components/ApplicationsTable";
import {
  APPLICATION_SORT_KEYS,
  type ApplicationSortKey,
  type SortDir,
} from "@/ui/table-sort";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

function isSortKey(v: string | undefined): v is ApplicationSortKey {
  return !!v && (APPLICATION_SORT_KEYS as readonly string[]).includes(v);
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; dir?: string }>;
}) {
  const { status, sort, dir } = await searchParams;
  const sortKey: ApplicationSortKey = isSortKey(sort) ? sort : "applied";
  const sortDir: SortDir = dir === "asc" ? "asc" : "desc";

  // Fetch the FULL dataset (all statuses); filtering happens client-side.
  const repo = createApplicationRepo(getDb());
  const rows: ApplicationRow[] = repo.listWithContext().map((r) => ({
    id: r.application.id,
    companyName: r.company.name,
    roleTitle: r.role.title,
    status: r.application.status,
    contactName: r.contact?.name ?? null,
    nextAction: r.application.nextAction,
    nextActionDate: r.application.nextActionDate,
    appliedAt: r.application.appliedAt,
  }));

  return (
    <main>
      <h1>Pipeline</h1>
      <p className="subtitle">{rows.length} applications in flight</p>

      <ApplicationsTable
        applications={rows}
        initialStatus={status}
        initialSort={sortKey}
        initialDir={sortDir}
      />
    </main>
  );
}
