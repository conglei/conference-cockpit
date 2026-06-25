/**
 * Ingest a conference agenda (speaker → sessions) into the `talks` table,
 * linking each session to the already-imported speaker `people` row (and that
 * person's company). Idempotent: re-running ingests nothing new (dedupe index).
 *
 * The matching seam is the judgment here — speakers in the agenda feed are
 * matched to existing person rows by LinkedIn URL first (canonical), then by
 * normalized name. Sessions whose speaker isn't in the DB are reported, not
 * guessed into existence.
 */
import type { Person } from "../db/schema";
import type { PersonRepo } from "../db/people-repository";
import type { TalkRepo } from "../db/talk-repository";

export interface SpeakerSession {
  title?: string;
  description?: string;
  day?: string;
  time?: string;
  room?: string;
  track?: string;
  type?: string;
}
export interface AgendaSpeaker {
  name: string;
  company?: string;
  linkedin?: string;
  sessions?: SpeakerSession[];
}

export interface IngestResult {
  speakersMatched: number;
  speakersUnmatched: number;
  unmatchedNames: string[];
  talksInserted: number;
  talksDuplicate: number;
  sessionsSkippedNoTitle: number;
}

const normLi = (u: string | null | undefined): string =>
  (u ?? "").toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function ingestTalks(
  deps: { people: PersonRepo; talks: TalkRepo },
  speakers: AgendaSpeaker[],
  opts: { sourceDetail?: string } = {},
): IngestResult {
  const allPeople = deps.people.list();
  const byLi = new Map<string, Person>();
  const byName = new Map<string, Person>();
  for (const p of allPeople) {
    if (p.linkedinUrl) byLi.set(normLi(p.linkedinUrl), p);
    byName.set(normName(p.name), p); // last wins; names are near-unique here
  }

  const res: IngestResult = {
    speakersMatched: 0,
    speakersUnmatched: 0,
    unmatchedNames: [],
    talksInserted: 0,
    talksDuplicate: 0,
    sessionsSkippedNoTitle: 0,
  };

  for (const sp of speakers) {
    const person =
      (sp.linkedin ? byLi.get(normLi(sp.linkedin)) : undefined) ??
      byName.get(normName(sp.name));
    if (!person) {
      res.speakersUnmatched++;
      res.unmatchedNames.push(sp.name);
      continue;
    }
    res.speakersMatched++;
    for (const s of sp.sessions ?? []) {
      const title = (s.title ?? "").trim();
      if (!title) {
        res.sessionsSkippedNoTitle++;
        continue;
      }
      const inserted = deps.talks.createIgnore({
        speakerId: person.id,
        companyId: person.companyId ?? null,
        title,
        description: s.description ?? null,
        day: s.day ?? null,
        time: s.time ?? null,
        room: s.room ?? null,
        track: s.track ?? null,
        type: s.type ?? null,
        source: "manual",
        sourceDetail: opts.sourceDetail ?? null,
        raw: JSON.stringify(s),
      });
      if (inserted) res.talksInserted++;
      else res.talksDuplicate++;
    }
  }
  return res;
}
