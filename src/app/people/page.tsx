import { getDb } from "@/db/client";
import { asList } from "@/db/columns";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo } from "@/db/repository";
import { createTalkRepo } from "@/db/talk-repository";
import PeopleDirectory, { type PersonCardData } from "../_components/PeopleTable";

// The DB is read at request time, not build time.
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string; speaking?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();
  // Three bounded queries: people + companies (for employer/verticals) + talks
  // (for the speaking flag). Indexed in memory — no per-person lookups.
  const [people, companies, talks] = await Promise.all([
    createPersonRepo(db).list(),
    createCompanyRepo(db).list(),
    createTalkRepo(db).list(),
  ]);
  const byId = new Map(companies.map((c) => [c.id, c]));
  const speakerIds = new Set(
    talks.map((t) => t.speakerId).filter((id): id is number => id != null),
  );

  const cards: PersonCardData[] = people.map((p) => {
    const co = p.companyId != null ? byId.get(p.companyId) : undefined;
    return {
      slug: p.slug,
      name: p.name,
      headline: p.headline ?? p.title ?? null,
      companyName: p.currentCompany ?? co?.name ?? null,
      verticals: asList(co?.verticals),
      speaking: speakerIds.has(p.id),
      photoUrl: p.photoUrl ?? null,
      location: p.location ?? null,
    };
  });

  return (
    <main className="dir-main">
      <p className="subtitle">
        <a href="/">← Who to meet</a>
      </p>
      <h1>People</h1>
      <p className="subtitle">
        {cards.length} people in the graph — search by name, role, company, or vertical.
        For a ranked, taste-driven shortlist, see <a href="/">Who to meet</a>.
      </p>

      <PeopleDirectory
        people={cards}
        initialQuery={sp.q}
        initialVertical={sp.vertical}
        initialSpeaking={sp.speaking === "1"}
        initialSort={sp.sort}
      />
    </main>
  );
}
