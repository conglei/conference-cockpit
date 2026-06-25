import { getDb } from "@/db/client";
import { createCompanyRepo } from "@/db/repository";
import { isScoreAxis, type ScoreAxis } from "@/scoring";
import CompaniesTable from "./_components/CompaniesTable";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; dir?: string }>;
}) {
  const { status, sort, dir } = await searchParams;
  // Seed the client table's initial state from the URL so deep links land
  // correctly; the table validates `status` itself (chips drive it from there).
  const sortAxis: ScoreAxis = isScoreAxis(sort) ? sort : "overall";
  const sortDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  // Fetch the FULL dataset (all statuses); filtering happens client-side.
  const repo = createCompanyRepo(getDb());
  const companies = repo.list();

  return (
    <main>
      <h1>Companies</h1>
      <p className="subtitle">
        {companies.length} companies in the funnel ·{" "}
        <a href="/who-next">Who next →</a>
      </p>

      <CompaniesTable
        companies={companies}
        initialStatus={status}
        initialSort={sortAxis}
        initialDir={sortDir}
      />
    </main>
  );
}
