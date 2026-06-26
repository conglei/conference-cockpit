import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createSpeakerEmbeddingRepo } from "../src/db/speaker-embedding-repository";
import { createPersonRepo } from "../src/db/people-repository";
import { ingestEmbeddings, type EmbeddingsFeed } from "../src/speakers/ingest-embeddings";
import { cosine, searchByVector, nearestToSpeaker } from "../src/speakers/semantic-search";

describe("cosine", () => {
  it("is 1 for identical, 0 for orthogonal", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("guards against zero vectors", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

async function seed() {
  const db = await createTestDb();
  const embeddings = createSpeakerEmbeddingRepo(db);
  await embeddings.upsertByExternalId({ externalId: "x0", name: "East", embedding: JSON.stringify([1, 0]) });
  await embeddings.upsertByExternalId({ externalId: "x1", name: "Northeast", embedding: JSON.stringify([0.9, 0.1]) });
  await embeddings.upsertByExternalId({ externalId: "x2", name: "North", embedding: JSON.stringify([0, 1]) });
  return { db, embeddings };
}

describe("searchByVector", () => {
  it("ranks by cosine, closest first, honoring k", async () => {
    const { embeddings } = await seed();
    const out = await searchByVector(embeddings, [1, 0], 2);
    expect(out.map((m) => m.externalId)).toEqual(["x0", "x1"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });
});

describe("nearestToSpeaker", () => {
  it("excludes the seed and returns the closest other", async () => {
    const { embeddings } = await seed();
    const out = await nearestToSpeaker(embeddings, "x0", 1);
    expect(out.map((m) => m.externalId)).toEqual(["x1"]);
  });
  it("returns [] for an unknown seed", async () => {
    const { embeddings } = await seed();
    expect(await nearestToSpeaker(embeddings, "nope")).toEqual([]);
  });
});

describe("ingestEmbeddings", () => {
  it("ingests vectors, links by name, skips empty, is idempotent", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    const embeddings = createSpeakerEmbeddingRepo(db);
    const grace = await people.create({ slug: "g", name: "Grace Hopper", relationship: "network_contact" });

    const feed: EmbeddingsFeed = {
      model: "test-model",
      dimensions: 2,
      speakers: [
        { id: "s0", name: "Grace Hopper", embedding: [1, 0] },
        { id: "s1", name: "Unknown Person", embedding: [0, 1] },
        { id: "s2", name: "No Vector", embedding: [] },
      ],
    };

    const res = await ingestEmbeddings({ people, embeddings }, feed);
    expect(res.ingested).toBe(2);
    expect(res.linkedToPerson).toBe(1);
    expect(res.skippedNoVector).toBe(1);
    expect((await embeddings.byExternalId("s0"))!.personId).toBe(grace.id);

    // Re-ingest refreshes in place (no duplicate rows).
    await ingestEmbeddings({ people, embeddings }, feed);
    expect(await embeddings.count()).toBe(2);
  });
});
