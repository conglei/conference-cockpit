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
    createIgnore(input: TalkInput): Talk | undefined {
      const ts = Date.now();
      return db
        .insert(talks)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .onConflictDoNothing()
        .returning()
        .get();
    },

    list(): Talk[] {
      return db.select().from(talks).all();
    },

    bySpeaker(speakerId: number): Talk[] {
      return db.select().from(talks).where(eq(talks.speakerId, speakerId)).all();
    },

    byCompany(companyId: number): Talk[] {
      return db.select().from(talks).where(eq(talks.companyId, companyId)).all();
    },

    count(): number {
      return db.select().from(talks).all().length;
    },
  };
}

export type TalkRepo = ReturnType<typeof createTalkRepo>;
