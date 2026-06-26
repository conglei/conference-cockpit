/**
 * Backfill speaker PROFILE fields (bio, photo, twitter) onto existing `people`
 * rows from the conference speakers feed. Sibling to {@link ingestTalks}: that
 * one lands sessions, this one enriches the person. Same matching seam — LinkedIn
 * URL first (canonical), then normalized name — and the same "report, don't
 * invent" rule: a feed speaker with no person row is counted, not created.
 *
 * Idempotent and non-destructive: only non-empty feed values are written, and an
 * existing value is never clobbered with a blank.
 */
import type { Person } from "../db/schema";
import type { PersonRepo } from "../db/people-repository";

export interface SpeakerProfile {
  name: string;
  linkedin?: string;
  bio?: string;
  photoUrl?: string;
  /** Twitter/X URL (present in the embeddings feed, not the speakers feed). */
  twitter?: string;
}

export interface IngestProfilesResult {
  matched: number;
  unmatched: number;
  unmatchedNames: string[];
  bioSet: number;
  photoSet: number;
  twitterSet: number;
}

const normLi = (u: string | null | undefined): string =>
  (u ?? "").toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function ingestSpeakerProfiles(
  deps: { people: PersonRepo },
  speakers: SpeakerProfile[],
): Promise<IngestProfilesResult> {
  const all = await deps.people.list();
  const byLi = new Map<string, Person>();
  const byName = new Map<string, Person>();
  for (const p of all) {
    if (p.linkedinUrl) byLi.set(normLi(p.linkedinUrl), p);
    byName.set(normName(p.name), p);
  }

  const res: IngestProfilesResult = {
    matched: 0,
    unmatched: 0,
    unmatchedNames: [],
    bioSet: 0,
    photoSet: 0,
    twitterSet: 0,
  };

  for (const sp of speakers) {
    const person =
      (sp.linkedin ? byLi.get(normLi(sp.linkedin)) : undefined) ?? byName.get(normName(sp.name));
    if (!person) {
      res.unmatched++;
      res.unmatchedNames.push(sp.name);
      continue;
    }
    res.matched++;

    const patch: { bio?: string; photoUrl?: string; twitterUrl?: string } = {};
    const bio = sp.bio?.trim();
    const photo = sp.photoUrl?.trim();
    const twitter = sp.twitter?.trim();
    // Write only when the feed has a value and the row doesn't already (no clobber).
    if (bio && !person.bio) patch.bio = bio;
    if (photo && !person.photoUrl) patch.photoUrl = photo;
    if (twitter && !person.twitterUrl) patch.twitterUrl = twitter;

    if (Object.keys(patch).length > 0) {
      await deps.people.update(person.id, patch);
      if (patch.bio) res.bioSet++;
      if (patch.photoUrl) res.photoSet++;
      if (patch.twitterUrl) res.twitterSet++;
    }
  }
  return res;
}
