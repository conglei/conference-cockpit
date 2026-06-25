/**
 * Ingest the precomputed speaker embeddings feed (AIE speakers-embeddings.json)
 * into `speaker_embeddings`. Each feed entry carries a stable `id`, identity
 * fields, and a vector; we store the vector as JSON and link it to a `people`
 * row by normalized name when one exists (the feed includes speakers outside our
 * directory, so `person_id` is nullable). Idempotent via `upsertByExternalId`.
 */
import type { Person } from "../db/schema";
import type { PersonRepo } from "../db/people-repository";
import type { SpeakerEmbeddingRepo } from "../db/speaker-embedding-repository";

export interface EmbeddingSpeaker {
  id: string;
  name: string;
  role?: string;
  company?: string;
  twitter?: string;
  embedding: number[];
}

export interface EmbeddingsFeed {
  model?: string;
  dimensions?: number;
  speakers: EmbeddingSpeaker[];
}

export interface IngestEmbeddingsResult {
  ingested: number;
  linkedToPerson: number;
  skippedNoVector: number;
}

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function ingestEmbeddings(
  deps: { people: PersonRepo; embeddings: SpeakerEmbeddingRepo },
  feed: EmbeddingsFeed,
): IngestEmbeddingsResult {
  const byName = new Map<string, Person>();
  for (const p of deps.people.list()) byName.set(normName(p.name), p);

  const res: IngestEmbeddingsResult = { ingested: 0, linkedToPerson: 0, skippedNoVector: 0 };

  for (const sp of feed.speakers ?? []) {
    if (!Array.isArray(sp.embedding) || sp.embedding.length === 0) {
      res.skippedNoVector++;
      continue;
    }
    const person = byName.get(normName(sp.name));
    deps.embeddings.upsertByExternalId({
      personId: person?.id ?? null,
      externalId: sp.id,
      name: sp.name,
      role: sp.role ?? null,
      company: sp.company ?? null,
      model: feed.model ?? null,
      dimensions: feed.dimensions ?? sp.embedding.length,
      embedding: JSON.stringify(sp.embedding),
    });
    res.ingested++;
    if (person) res.linkedToPerson++;
  }
  return res;
}
