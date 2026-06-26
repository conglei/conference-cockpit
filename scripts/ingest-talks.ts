/**
 * CLI: ingest a conference agenda (speakers + their sessions) into the `talks`
 * table, linking each session to the already-imported speaker person row.
 *
 *   pnpm ingest-talks                         # default: seed/aie-wf-2026.json
 *   pnpm ingest-talks path/to/agenda.json     # any agenda with the same shape
 *
 * Idempotent — safe to re-run; the (speaker_id, title, time) unique index
 * dedupes. Speakers not yet present as `people` rows are reported, not created
 * (run the speaker import first).
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { ingestTalks, type AgendaSpeaker } from "../src/talks/ingest";

loadEnvFile();

async function main() {
  const path = process.argv[2] ?? "seed/aie-wf-2026.json";
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    conference?: string;
    speakers: AgendaSpeaker[];
  };
  const db = createDb();
  const res = await ingestTalks(
    { people: createPersonRepo(db), talks: createTalkRepo(db) },
    data.speakers,
    { sourceDetail: data.conference ?? path },
  );

  console.log(`Agenda: ${path} (${data.speakers.length} speakers)`);
  console.log(
    `  speakers matched: ${res.speakersMatched}, unmatched: ${res.speakersUnmatched}`,
  );
  console.log(
    `  talks inserted: ${res.talksInserted}, duplicate (already ingested): ${res.talksDuplicate}` +
      (res.sessionsSkippedNoTitle ? `, skipped (no title): ${res.sessionsSkippedNoTitle}` : ""),
  );
  if (res.unmatchedNames.length) {
    console.log(
      `  unmatched speakers (no person row): ${res.unmatchedNames.slice(0, 10).join(", ")}` +
        (res.unmatchedNames.length > 10 ? ` … +${res.unmatchedNames.length - 10}` : ""),
    );
  }
}

await main();
