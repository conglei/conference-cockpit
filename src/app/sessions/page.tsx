import { getDb } from "@/db/client";
import { createTalkRepo } from "@/db/talk-repository";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo } from "@/db/repository";
import SessionsExplorer, {
  type SessionRow,
} from "../_components/SessionsExplorer";

// Read the DB at request time, not build time.
export const dynamic = "force-dynamic";

/** Parse "10:45am" → minutes-of-day (for ordering + "happening now"). */
function toMinutes(clock: string | undefined): number | null {
  if (!clock) return null;
  const m = clock.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

export default async function SessionsPage() {
  const db = getDb();
  const talks = createTalkRepo(db).list();

  const people = new Map(
    createPersonRepo(db)
      .list()
      .map((p) => [p.id, p] as const),
  );
  const companies = new Map(
    createCompanyRepo(db)
      .list()
      .map((c) => [c.id, c] as const),
  );

  const rows: SessionRow[] = talks.map((t) => {
    const [startRaw, endRaw] = (t.time ?? "").split(/[-–]/).map((s) => s.trim());
    const speaker = t.speakerId != null ? people.get(t.speakerId) : undefined;
    const company = t.companyId != null ? companies.get(t.companyId) : undefined;
    return {
      id: t.id,
      title: t.title,
      day: t.day ?? "Unscheduled",
      time: t.time ?? null,
      startMin: toMinutes(startRaw),
      endMin: toMinutes(endRaw),
      room: t.room ?? null,
      track: t.track ?? null,
      speakerName: speaker?.name ?? null,
      speakerSlug: speaker?.slug ?? null,
      companyName: company?.name ?? null,
      companySlug: company?.slug ?? null,
    };
  });

  // Stable order: by day, then start time, then title.
  rows.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.startMin ?? 9999) - (b.startMin ?? 9999) ||
      a.title.localeCompare(b.title),
  );

  return (
    <main className="sessions-main">
      <p className="subtitle">
        <a href="/">← The plan</a>
      </p>
      <h1>Sessions</h1>
      <p className="subtitle">
        {rows.length} talks across {new Set(rows.map((r) => r.day)).size} days —
        browse the agenda, jump to what&apos;s on now.
      </p>

      <SessionsExplorer sessions={rows} />
    </main>
  );
}
