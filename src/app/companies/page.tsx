import { getDb } from "@/db/client";
import { asList } from "@/db/columns";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import CompaniesDirectory, {
  type CompanyCardData,
} from "../_components/CompaniesTable";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string; sort?: string; hiring?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  // Two light queries (companies + a grouped role count) instead of loading all
  // ~2,373 role rows just to count them — much faster over a remote DB.
  const [companies, roleCount] = await Promise.all([
    createCompanyRepo(db).list(),
    createRoleRepo(db).countsByCompany(),
  ]);

  const cards: CompanyCardData[] = companies.map((c) => ({
    slug: c.slug,
    name: c.name,
    domain: c.domain ?? null,
    description: c.description ?? null,
    industry: c.industry ?? null,
    verticals: asList(c.verticals),
    stage: c.stage ?? null,
    location: c.location ?? null,
    headcount: c.headcount != null ? String(c.headcount) : c.sizeBand ?? null,
    latestRound: c.latestRound ?? null,
    fundingTotal: c.fundingTotal ?? null,
    lastFundingDate: c.lastFundingDate ?? null,
    roleCount: roleCount.get(c.id) ?? 0,
    score: c.scoreOverall != null ? Math.round(c.scoreOverall * 100) : null,
  }));

  return (
    <main className="dir-main">
      <h1>Companies</h1>
      <p className="subtitle">
        {cards.length} companies in the graph — filter by what they do, who&apos;s
        hiring, and where they are.
      </p>

      <CompaniesDirectory
        companies={cards}
        initialQuery={sp.q}
        initialVertical={sp.vertical}
        initialSort={sp.sort}
        initialHiring={sp.hiring === "1"}
      />
    </main>
  );
}
