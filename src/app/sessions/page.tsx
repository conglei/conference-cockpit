import { getDb } from "@/db/client";
import { createTalkRepo } from "@/db/talk-repository";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo } from "@/db/repository";
import SessionsExplorer, {
  type SessionRow,
} from "../_components/SessionsExplorer";

// Read the DB at request time, not build time.
export const dynamic = "force-dynamic";

// Day 1 of the conference (Workshop Day). Override per-conference via env.
// "Day N — …" maps to CONFERENCE_START + (N-1) days, giving real calendar dates
// so the "happening now" marker is a true date+time match, not just time-of-day.
const CONFERENCE_START = process.env.CONFERENCE_START_DATE ?? "2026-06-29";

/** Parse "10:45am" → minutes-of-day (for ordering + "happening now"). */
function toMinutes(clock: string | undefined): number | null {
  if (!clock) return null;
  const m = clock.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

/** "Day 2 — Session Day 1" → ISO date (CONFERENCE_START + 1 day). */
function dateForDay(dayLabel: string): string | null {
  const m = dayLabel.match(/day\s+(\d+)/i);
  if (!m) return null;
  const [y, mo, d] = CONFERENCE_START.split("-").map(Number);
  // Date.UTC handles month rollover (Jun 29 + 3 → Jul 2); slice keeps Y-M-D.
  return new Date(Date.UTC(y, mo - 1, d + (Number(m[1]) - 1))).toISOString().slice(0, 10);
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
      date: t.day ? dateForDay(t.day) : null,
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
        {rows.length} talks · Jun 29 – Jul 2, 2026 — browse the agenda, jump to
        what&apos;s on now.
      </p>

      <SessionsExplorer sessions={rows} />
    </main>
  );
}
