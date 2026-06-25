import { getDb } from "@/db/client";
import { createCompanyRepo } from "@/db/repository";
import { isScoreAxis, type ScoreAxis } from "@/scoring/sort";
import CompaniesTable from "../_components/CompaniesTable";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; dir?: string }>;
}) {
  const { status, sort, dir } = await searchParams;
  const sortKey: ScoreAxis = isScoreAxis(sort) ? sort : "overall";
  const sortDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  const db = getDb();
  const companies = createCompanyRepo(db).list();

  return (
    <main>
      <p className="subtitle">
        <a href="/">← Who to meet</a>
      </p>
      <h1>Companies</h1>
      <p className="subtitle">
        {companies.length} companies in the graph — sortable by any score axis.
        Tap a name for the full brief.
      </p>

      <CompaniesTable
        companies={companies}
        initialStatus={status}
        initialSort={sortKey}
        initialDir={sortDir}
      />
    </main>
  );
}
