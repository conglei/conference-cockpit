/**
 * Sync the conference graph from the live feeds (speakers + sessions).
 *
 *   pnpm tsx scripts/sync-conference.mts [speakers.json] [sessions.json] [--dry-run]
 *
 * Three things the stock ingest-speakers/ingest-talks don't do together:
 *   1. CREATE person rows for speakers we don't have yet (matched by LinkedIn
 *      then normalized name) — the existing scripts only enrich/link.
 *   2. Land each speaker's sessions + backfill bio/photo (delegates to the
 *      existing ingestTalks / ingestSpeakerProfiles; idempotent via the dedupe
 *      index).
 *   3. Land SPEAKER-LESS sessions from the sessions feed (expo sessions,
 *      keynotes/TBA, breaks) as talks with a null speaker — the part the speakers
 *      feed can't carry. Deduped by (title, day, time) since the unique index
 *      doesn't dedupe null speakers.
 *
 * Idempotent: safe to re-run against local or Turso.
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { talks as talksTable } from "../src/db/schema";
import { ingestTalks, type AgendaSpeaker } from "../src/talks/ingest";
import { ingestSpeakerProfiles, type SpeakerProfile } from "../src/speakers/ingest-profiles";

loadEnvFile();

type FeedSpeaker = AgendaSpeaker & SpeakerProfile & { role?: string; company?: string };
type FeedSession = {
  title?: string;
  description?: string;
  day?: string;
  time?: string;
  room?: string;
  track?: string;
  type?: string;
  speakers?: string[];
};

const SPEAKERS_URL = "https://www.ai.engineer/worldsfair/speakers.json";
const SESSIONS_URL = "https://www.ai.engineer/worldsfair/sessions.json";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
// --rebuild wipes the talks table first, so the agenda exactly matches the feeds
// (drops stale sessions the live schedule has since renamed/removed). Talks carry
// no scores, so this is safe; people/companies are untouched.
const rebuild = args.includes("--rebuild");
const paths = args.filter((a) => !a.startsWith("--"));
const speakersSrc = paths[0] ?? SPEAKERS_URL;
const sessionsSrc = paths[1] ?? SESSIONS_URL;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normLi = (u: string | null | undefined) =>
  (u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const load = async (src: string) =>
  src.startsWith("http") ? (await (await fetch(src)).text()) : readFileSync(src, "utf8");

const conf = "AI Engineer World's Fair 2026";
const speakers = (JSON.parse(await load(speakersSrc)) as { speakers: FeedSpeaker[] }).speakers;
const sessions = (JSON.parse(await load(sessionsSrc)) as { sessions: FeedSession[] }).sessions;

const db = createDb();
const people = createPersonRepo(db);
const companies = createCompanyRepo(db);
const talks = createTalkRepo(db);

// --- 1. create missing people --------------------------------------------
const existing = await people.list();
const byName = new Map(existing.map((p) => [norm(p.name), p]));
const byLi = new Map(existing.filter((p) => p.linkedinUrl).map((p) => [normLi(p.linkedinUrl), p]));
const slugs = new Set(existing.map((p) => p.slug));
const coByName = new Map((await companies.list()).map((c) => [norm(c.name), c.id]));

let created = 0;
for (const sp of speakers) {
  if ((sp.linkedin ? byLi.get(normLi(sp.linkedin)) : undefined) ?? byName.get(norm(sp.name))) continue;
  let slug = slugify(sp.name) || "speaker";
  for (let i = 2; slugs.has(slug); i++) slug = `${slugify(sp.name)}-${i}`;
  slugs.add(slug);
  created++;
  if (!dry)
    await people.create({
      slug,
      name: sp.name,
      relationship: "network_contact",
      headline: sp.role || null,
      currentCompany: sp.company || null,
      bio: sp.bio || null,
      photoUrl: sp.photoUrl || null,
      linkedinUrl: sp.linkedin || null,
      companyId: sp.company ? coByName.get(norm(sp.company)) ?? null : null,
    });
}
console.log(`${dry ? "[dry-run] " : ""}People created: ${created}`);

if (dry) process.exit(0);

if (rebuild) {
  await db.delete(talksTable).run();
  console.log("Cleared talks (rebuild) — re-ingesting from the live feeds.");
}

// --- 2. speaker sessions + profile backfill ------------------------------
const t = await ingestTalks({ people, talks }, speakers, { sourceDetail: conf });
console.log(`Speaker talks — inserted: ${t.talksInserted}, duplicate: ${t.talksDuplicate}, unmatched: ${t.speakersUnmatched}`);
const pr = await ingestSpeakerProfiles({ people }, speakers);
console.log(`Profiles — bio: ${pr.bioSet}, photo: ${pr.photoSet}`);

// --- 3. speaker-less sessions (null speaker), deduped by slot+title -------
const seen = new Set(
  (await talks.list()).map((x) => `${norm(x.title)}|${x.day ?? ""}|${x.time ?? ""}`),
);
let sessionsAdded = 0;
for (const s of sessions) {
  if (s.speakers && s.speakers.length) continue; // speaker-having → handled above
  const title = (s.title ?? "").trim();
  if (!title) continue;
  const key = `${norm(title)}|${s.day ?? ""}|${s.time ?? ""}`;
  if (seen.has(key)) continue;
  seen.add(key);
  sessionsAdded++;
  await talks.createIgnore({
    speakerId: null,
    companyId: null,
    title,
    description: s.description ?? null,
    day: s.day ?? null,
    time: s.time ?? null,
    room: s.room ?? null,
    track: s.track ?? null,
    type: s.type ?? null,
    source: "manual",
    sourceDetail: conf,
    raw: JSON.stringify(s),
  });
}
console.log(`Speaker-less sessions added: ${sessionsAdded}`);
