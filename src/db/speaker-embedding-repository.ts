import { eq } from "drizzle-orm";
import type { DB } from "./client";
import { speakerEmbeddings, type SpeakerEmbedding, type NewSpeakerEmbedding } from "./schema";

export type SpeakerEmbeddingInput = Omit<NewSpeakerEmbedding, "id" | "createdAt" | "updatedAt">;

/**
 * Typed data layer for speaker embeddings (semantic search). Mirrors the other
 * repos: no raw SQL elsewhere (ADR-0001). `upsertByExternalId` makes embedding
 * ingest idempotent against the `external_id` unique index — re-ingesting a
 * regenerated feed refreshes the vector and the person link in place.
 */
export function createSpeakerEmbeddingRepo(db: DB) {
  return {
    async upsertByExternalId(input: SpeakerEmbeddingInput): Promise<SpeakerEmbedding> {
      const ts = Date.now();
      return db
        .insert(speakerEmbeddings)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .onConflictDoUpdate({
          target: speakerEmbeddings.externalId,
          set: {
            personId: input.personId ?? null,
            name: input.name,
            role: input.role ?? null,
            company: input.company ?? null,
            model: input.model ?? null,
            dimensions: input.dimensions ?? null,
            embedding: input.embedding,
            updatedAt: ts,
          },
        })
        .returning()
        .get();
    },

    async list(): Promise<SpeakerEmbedding[]> {
      return db.select().from(speakerEmbeddings).all();
    },

    async byExternalId(externalId: string): Promise<SpeakerEmbedding | undefined> {
      return db
        .select()
        .from(speakerEmbeddings)
        .where(eq(speakerEmbeddings.externalId, externalId))
        .get();
    },

    async count(): Promise<number> {
      return (await db.select().from(speakerEmbeddings).all()).length;
    },
  };
}

export type SpeakerEmbeddingRepo = ReturnType<typeof createSpeakerEmbeddingRepo>;
