/**
 * Derive each company's CONFERENCE VERTICALS from the distinct `track`s of its
 * speakers' talks, and persist them to `companies.verticals` (a JSON array
 * string). This is the queryable taxonomy behind "show me healthcare companies":
 * a company is "in" AI in Healthcare iff one of its speakers gave a talk on that
 * track.
 *
 * Logistical/format tracks (Workshops, numbered/lettered Tracks, Main Stage, Expo
 * Stages) are NOT verticals — they're rooms/slots — so they're filtered out. What
 * remains is the topical taxonomy (AI in Healthcare, AI in Finance, Security, …).
 */
import type { CompanyRepo } from "../db/repository";
import type { TalkRepo } from "../db/talk-repository";

/** Tracks that describe a room/format, not a topic — excluded from verticals. */
const GENERIC_TRACK =
  /^(workshops\b|track\s|track\s*[a-z]$|main stage\b|expo stage\b|keynote)/i;

export interface RollUpVerticalsResult {
  companiesUpdated: number;
  distinctVerticals: string[];
}

/** True when a track names a topical vertical (not a logistics/format slot). */
export function isVerticalTrack(track: string | null | undefined): boolean {
  const t = track?.trim();
  if (!t) return false;
  return !GENERIC_TRACK.test(t);
}

export function rollUpVerticals(deps: {
  companies: CompanyRepo;
  talks: TalkRepo;
}): RollUpVerticalsResult {
  // Group distinct vertical tracks per company.
  const byCompany = new Map<number, Set<string>>();
  for (const talk of deps.talks.list()) {
    if (talk.companyId == null || !isVerticalTrack(talk.track)) continue;
    const set = byCompany.get(talk.companyId) ?? new Set<string>();
    set.add(talk.track!.trim());
    byCompany.set(talk.companyId, set);
  }

  const distinct = new Set<string>();
  let updated = 0;
  for (const [companyId, tracks] of byCompany) {
    const verticals = [...tracks].sort();
    verticals.forEach((v) => distinct.add(v));
    deps.companies.update(companyId, { verticals: JSON.stringify(verticals) });
    updated++;
  }

  return { companiesUpdated: updated, distinctVerticals: [...distinct].sort() };
}
