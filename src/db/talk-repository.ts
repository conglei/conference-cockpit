import { eq } from "drizzle-orm";
import type { DB } from "./client";
import { talks, type Talk, type NewTalk } from "./schema";

export type TalkInput = Omit<NewTalk, "id" | "createdAt" | "updatedAt">;

/**
 * Typed data layer for talks (conference sessions). Mirrors the company/role
 * repos: no raw SQL elsewhere (ADR-0001). `createIgnore` makes agenda ingest
 * idempotent against the (speaker_id, title, time) unique index.
 */
export function createTalkRepo(db: DB) {
  return {
    /** Insert a talk, ignoring re-ingests that collide on the dedupe index. */
    async createIgnore(input: TalkInput): Promise<Talk | undefined> {
      const ts = Date.now();
      return db
        .insert(talks)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .onConflictDoNothing()
        .returning()
        .get();
    },

    async list(): Promise<Talk[]> {
      return db.select().from(talks).all();
    },

    async bySpeaker(speakerId: number): Promise<Talk[]> {
      return db.select().from(talks).where(eq(talks.speakerId, speakerId)).all();
    },

    async byCompany(companyId: number): Promise<Talk[]> {
      return db.select().from(talks).where(eq(talks.companyId, companyId)).all();
    },

    async count(): Promise<number> {
      return (await db.select().from(talks).all()).length;
    },
  };
}

export type TalkRepo = ReturnType<typeof createTalkRepo>;
