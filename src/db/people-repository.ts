import { and, eq } from "drizzle-orm";
import type { DB } from "./client";
import { people, type Person, type NewPerson } from "./schema";

// Fields the caller provides; id/timestamps are managed by the data layer.
export type PersonInput = Omit<NewPerson, "id" | "createdAt" | "updatedAt">;
export type PersonPatch = Partial<Omit<NewPerson, "id" | "createdAt" | "updatedAt">>;

/**
 * The typed data layer for people. Mirrors the companies repo (see
 * src/db/repository.ts): all people reads/writes go through here; no raw SQL
 * elsewhere (docs/adr/0001-data-model.md).
 */
export function createPersonRepo(db: DB) {
  return {
    create(input: PersonInput): Person {
      const ts = Date.now();
      return db
        .insert(people)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    list(opts?: { companyId?: number }): Person[] {
      if (opts?.companyId !== undefined) {
        return db
          .select()
          .from(people)
          .where(eq(people.companyId, opts.companyId))
          .all();
      }
      return db.select().from(people).all();
    },

    get(id: number): Person | undefined {
      return db.select().from(people).where(eq(people.id, id)).get();
    },

    getBySlug(slug: string): Person | undefined {
      return db.select().from(people).where(eq(people.slug, slug)).get();
    },

    /** Look up a person by LinkedIn URL (the natural identity for dedupe). */
    getByLinkedinUrl(linkedinUrl: string): Person | undefined {
      return db
        .select()
        .from(people)
        .where(eq(people.linkedinUrl, linkedinUrl))
        .get();
    },

    /** All people linked to a company (used to prune stale founders on re-enrich). */
    listByCompany(companyId: number): Person[] {
      return db.select().from(people).where(eq(people.companyId, companyId)).all();
    },

    /** Delete a person by id. May throw if referenced (e.g. by an application). */
    remove(id: number): void {
      db.delete(people).where(eq(people.id, id)).run();
    },

    /**
     * All people who can give a warm intro (`can_refer = true`). Backed by the
     * `(can_refer, connection_degree)` index from ADR-0001 — the who-next read.
     */
    listReferrers(): Person[] {
      return db.select().from(people).where(eq(people.canRefer, true)).all();
    },

    /**
     * All 1st-degree network contacts ingested from the user's connections
     * export (`relationship = network_contact`, `connection_degree = 1`).
     */
    listConnections(): Person[] {
      return db
        .select()
        .from(people)
        .where(
          and(
            eq(people.relationship, "network_contact"),
            eq(people.connectionDegree, 1),
          ),
        )
        .all();
    },

    update(id: number, patch: PersonPatch): Person | undefined {
      return db
        .update(people)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(people.id, id))
        .returning()
        .get();
    },

    /** Link a person to a company (convenience over `update`). */
    linkToCompany(id: number, companyId: number): Person | undefined {
      return this.update(id, { companyId });
    },
  };
}

export type PersonRepo = ReturnType<typeof createPersonRepo>;
