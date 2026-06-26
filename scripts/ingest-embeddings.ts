/**
 * CLI: ingest precomputed speaker embeddings into `speaker_embeddings` for
 * semantic search, linking each to a `people` row by name when possible.
 *
 *   pnpm ingest-embeddings                          # default: live AIE feed
 *   pnpm ingest-embeddings path/to/embeddings.json  # local snapshot, same shape
 *
 * Idempotent via the `external_id` unique index (re-ingest refreshes vectors).
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createSpeakerEmbeddingRepo } from "../src/db/speaker-embedding-repository";
import { ingestEmbeddings, type EmbeddingsFeed } from "../src/speakers/ingest-embeddings";

loadEnvFile();

const DEFAULT_SRC = "https://www.ai.engineer/worldsfair/speakers-embeddings.json";

async function load(src: string): Promise<EmbeddingsFeed> {
  const text = src.startsWith("http")
    ? await (await fetch(src)).text()
    : readFileSync(src, "utf8");
  return JSON.parse(text) as EmbeddingsFeed;
}

async function main() {
  const src = process.argv[2] ?? DEFAULT_SRC;
  const feed = await load(src);
  const db = createDb(DB_URL);
  const res = await ingestEmbeddings(
    { people: createPersonRepo(db), embeddings: createSpeakerEmbeddingRepo(db) },
    feed,
  );

  console.log(`Embeddings feed: ${src} (model ${feed.model ?? "?"}, dim ${feed.dimensions ?? "?"})`);
  console.log(
    `  ingested: ${res.ingested}, linked to a person: ${res.linkedToPerson}, ` +
      `skipped (no vector): ${res.skippedNoVector}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
