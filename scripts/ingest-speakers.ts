/**
 * CLI: backfill speaker PROFILE fields (bio, photo) onto existing `people` rows
 * from the conference speakers feed.
 *
 *   pnpm ingest-speakers                       # default: live AIE speakers.json
 *   pnpm ingest-speakers path/to/speakers.json # local snapshot, same shape
 *
 * Idempotent and non-destructive (never clobbers an existing value). Speakers
 * with no matching person row are reported, not created.
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { ingestSpeakerProfiles, type SpeakerProfile } from "../src/speakers/ingest-profiles";

loadEnvFile();

const DEFAULT_SRC = "https://www.ai.engineer/worldsfair/2026/speakers.json";

async function load(src: string): Promise<{ speakers: SpeakerProfile[] }> {
  const text = src.startsWith("http")
    ? await (await fetch(src)).text()
    : readFileSync(src, "utf8");
  return JSON.parse(text) as { speakers: SpeakerProfile[] };
}

async function main() {
  const src = process.argv[2] ?? DEFAULT_SRC;
  const data = await load(src);
  const db = createDb(DB_URL);
  const res = ingestSpeakerProfiles({ people: createPersonRepo(db) }, data.speakers);

  console.log(`Speakers feed: ${src} (${data.speakers.length} speakers)`);
  console.log(`  matched: ${res.matched}, unmatched: ${res.unmatched}`);
  console.log(`  bio set: ${res.bioSet}, photo set: ${res.photoSet}, twitter set: ${res.twitterSet}`);
  if (res.unmatchedNames.length) {
    console.log(
      `  unmatched (no person row): ${res.unmatchedNames.slice(0, 10).join(", ")}` +
        (res.unmatchedNames.length > 10 ? ` … +${res.unmatchedNames.length - 10}` : ""),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
