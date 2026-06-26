/**
 * CLI: semantic "find speakers like this one" over the conference embeddings.
 * Uses a speaker's own stored vector as the query — no embedding API needed.
 *
 *   pnpm similar-speakers "Munjal Shah"     # by (sub)string of the speaker name
 *   pnpm similar-speakers worldsfair-speaker-0   # by feed external id
 *   pnpm similar-speakers "Abridge" --k 8
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createSpeakerEmbeddingRepo } from "../src/db/speaker-embedding-repository";
import { nearestToSpeaker } from "../src/speakers/semantic-search";

loadEnvFile();

async function main() {
  const args = process.argv.slice(2);
  let k = 10;
  const kFlag = args.indexOf("--k");
  if (kFlag !== -1) {
    k = Number(args[kFlag + 1]) || 10;
    args.splice(kFlag, 2);
  }
  const query = args.join(" ").trim();
  if (!query) {
    console.error('Usage: pnpm similar-speakers "<speaker name or external id>" [--k N]');
    process.exit(1);
  }

  const db = createDb(DB_URL);
  const repo = createSpeakerEmbeddingRepo(db);

  // Resolve the seed: exact external id, else first name/company substring match.
  const all = await repo.list();
  const q = query.toLowerCase();
  const seed =
    all.find((s) => s.externalId === query) ??
    all.find((s) => s.name.toLowerCase().includes(q)) ??
    all.find((s) => (s.company ?? "").toLowerCase().includes(q));

  if (!seed) {
    console.error(`No speaker found matching "${query}".`);
    process.exit(1);
  }

  console.log(`Seed: ${seed.name}${seed.company ? ` — ${seed.company}` : ""} (${seed.externalId})`);
  console.log(`Nearest ${k}:`);
  for (const m of await nearestToSpeaker(repo, seed.externalId, k)) {
    const co = m.company ? ` — ${m.company}` : "";
    console.log(`  ${m.score.toFixed(3)}  ${m.name}${co}${m.role ? ` (${m.role})` : ""}`);
  }
}

await main();
