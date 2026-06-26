import { getDb } from "@/db/client";
import { asList } from "@/db/columns";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo } from "@/db/repository";
import PeopleDirectory, { type PersonCardData } from "../_components/PeopleTable";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

type PeopleSort = "name" | "company" | "speaking";
function isSort(v: string | undefined): v is PeopleSort {
  return v === "name" || v === "company" || v === "speaking";
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string; speaking?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const vertical = sp.vertical ?? "all";
  const speaking = sp.speaking === "1";
  const sort: PeopleSort = isSort(sp.sort) ? sp.sort : "name";
  const page = Math.max(1, Number(sp.page) || 1);

  const db = getDb();
  // Filter + search + sort + paginate AT THE DB — projected to card fields (no
  // bio/work_history blobs), one page per request. Verticals list is a cheap
  // distinct over companies for the dropdown.
  const [{ rows, total }, verticals] = await Promise.all([
    createPersonRepo(db).listPeoplePage({
      q,
      vertical,
      speaking,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    createCompanyRepo(db).verticalsList(),
  ]);

  const cards: PersonCardData[] = rows.map((p) => ({
    slug: p.slug,
    name: p.name,
    headline: p.headline ?? p.title ?? null,
    companyName: p.currentCompany ?? p.companyName ?? null,
    verticals: asList(p.verticals),
    speaking: Boolean(p.speaking),
    photoUrl: p.photoUrl ?? null,
    location: p.location ?? null,
  }));

  const filtered = q !== "" || vertical !== "all" || speaking;

  return (
    <main className="dir-main">
      <p className="subtitle">
        <a href="/">← Who to meet</a>
      </p>
      <h1>People</h1>
      <p className="subtitle">
        {total.toLocaleString()} {filtered ? "matching " : ""}people in the graph — search by name,
        role, company, or vertical. For a ranked, taste-driven shortlist, see <a href="/">Who to meet</a>.
      </p>

      <PeopleDirectory
        people={cards}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        vertical={vertical}
        verticals={verticals}
        speaking={speaking}
        sort={sort}
      />
    </main>
  );
}
