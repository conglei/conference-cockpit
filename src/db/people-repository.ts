import { and, asc, count, desc, eq, exists, like, or, sql } from "drizzle-orm";
import type { DB } from "./client";
import { people, companies, talks, type Person, type NewPerson } from "./schema";

// Fields the caller provides; id/timestamps are managed by the data layer.
export type PersonInput = Omit<NewPerson, "id" | "createdAt" | "updatedAt">;
export type PersonPatch = Partial<Omit<NewPerson, "id" | "createdAt" | "updatedAt">>;

/** A person projected for the directory — only the card fields, joined to company. */
export type PersonCardRow = {
  slug: string;
  name: string;
  headline: string | null;
  title: string | null;
  currentCompany: string | null;
  photoUrl: string | null;
  location: string | null;
  companyName: string | null;
  verticals: string | null;
  speaking: number;
};

/**
 * The typed data layer for people. Mirrors the companies repo (see
 * src/db/repository.ts): all people reads/writes go through here; no raw SQL
 * elsewhere (docs/adr/0001-data-model.md).
 */
export function createPersonRepo(db: DB) {
  return {
    async create(input: PersonInput): Promise<Person> {
      const ts = Date.now();
      return db
        .insert(people)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    async list(opts?: { companyId?: number }): Promise<Person[]> {
      if (opts?.companyId !== undefined) {
        return db
          .select()
          .from(people)
          .where(eq(people.companyId, opts.companyId))
          .all();
      }
      return db.select().from(people).all();
    },

    /**
     * One PAGE of the people directory — projected (card fields only, NOT the
     * heavy bio/work_history/education blobs), joined to the company, filtered,
     * searched, sorted, and paginated AT THE DB. `speaking` is an EXISTS over
     * talks. Returns the page rows + total matching count.
     */
    async listPeoplePage(opts: {
      q?: string;
      vertical?: string;
      speaking?: boolean;
      sort?: "name" | "company" | "speaking";
      limit: number;
      offset: number;
    }): Promise<{ rows: PersonCardRow[]; total: number }> {
      const speaks = exists(
        db.select({ x: sql`1` }).from(talks).where(eq(talks.speakerId, people.id)),
      );
      const conds = [];
      if (opts.speaking) conds.push(speaks);
      if (opts.vertical && opts.vertical !== "all")
        conds.push(like(companies.verticals, `%"${opts.vertical}"%`));
      const needle = opts.q?.trim();
      if (needle) {
        const pat = `%${needle}%`;
        conds.push(
          or(
            like(people.name, pat),
            like(people.headline, pat),
            like(people.title, pat),
            like(people.currentCompany, pat),
            like(companies.name, pat),
          ),
        );
      }
      const where = conds.length === 1 ? conds[0] : conds.length ? and(...conds) : undefined;

      const order =
        opts.sort === "company"
          ? [asc(companies.name), asc(people.name)]
          : opts.sort === "speaking"
            ? [desc(speaks), asc(people.name)]
            : [asc(people.name)];

      const rowsQ = db
        .select({
          slug: people.slug,
          name: people.name,
          headline: people.headline,
          title: people.title,
          currentCompany: people.currentCompany,
          photoUrl: people.photoUrl,
          location: people.location,
          companyName: companies.name,
          verticals: companies.verticals,
          speaking: sql<number>`(${speaks})`,
        })
        .from(people)
        .leftJoin(companies, eq(people.companyId, companies.id))
        .$dynamic();
      if (where) rowsQ.where(where);
      const rows = (await rowsQ.orderBy(...order).limit(opts.limit).offset(opts.offset).all()) as PersonCardRow[];

      const countQ = db
        .select({ n: count() })
        .from(people)
        .leftJoin(companies, eq(people.companyId, companies.id))
        .$dynamic();
      if (where) countQ.where(where);
      const total = (await countQ.get())?.n ?? 0;

      return { rows, total };
    },

    async get(id: number): Promise<Person | undefined> {
      return db.select().from(people).where(eq(people.id, id)).get();
    },

    async getBySlug(slug: string): Promise<Person | undefined> {
      return db.select().from(people).where(eq(people.slug, slug)).get();
    },

    /** Look up a person by LinkedIn URL (the natural identity for dedupe). */
    async getByLinkedinUrl(linkedinUrl: string): Promise<Person | undefined> {
      return db
        .select()
        .from(people)
        .where(eq(people.linkedinUrl, linkedinUrl))
        .get();
    },

    /** All people linked to a company (used to prune stale founders on re-enrich). */
    async listByCompany(companyId: number): Promise<Person[]> {
      return db.select().from(people).where(eq(people.companyId, companyId)).all();
    },

    /** Delete a person by id. May throw if referenced (e.g. by an application). */
    async remove(id: number): Promise<void> {
      await db.delete(people).where(eq(people.id, id)).run();
    },

    /**
     * All people who can give a warm intro (`can_refer = true`). Backed by the
     * `(can_refer, connection_degree)` index from ADR-0001 — the who-next read.
     */
    async listReferrers(): Promise<Person[]> {
      return db.select().from(people).where(eq(people.canRefer, true)).all();
    },

    /**
     * All 1st-degree network contacts ingested from the user's connections
     * export (`relationship = network_contact`, `connection_degree = 1`).
     */
    async listConnections(): Promise<Person[]> {
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

    async update(id: number, patch: PersonPatch): Promise<Person | undefined> {
      return db
        .update(people)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(people.id, id))
        .returning()
        .get();
    },

    /** Link a person to a company (convenience over `update`). */
    async linkToCompany(id: number, companyId: number): Promise<Person | undefined> {
      return this.update(id, { companyId });
    },
  };
}

export type PersonRepo = ReturnType<typeof createPersonRepo>;
