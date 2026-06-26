import { and, asc, count, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { DB } from "./client";
import {
  companies,
  roles,
  COMPANY_STATUS,
  type Company,
  type NewCompany,
  type CompanyStatus,
  type Role,
  type NewRole,
  type RoleStatus,
  type WorkType,
} from "./schema";

// Fields the caller provides; id/timestamps are managed by the data layer.
export type CompanyInput = Omit<NewCompany, "id" | "createdAt" | "updatedAt">;
export type CompanyPatch = Partial<Omit<NewCompany, "id" | "createdAt" | "updatedAt">>;

/**
 * The typed data layer for companies. All company reads/writes go through here;
 * no raw SQL elsewhere (see docs/adr/0001-data-model.md).
 */
export function createCompanyRepo(db: DB) {
  return {
    async create(input: CompanyInput): Promise<Company> {
      const ts = Date.now();
      return db
        .insert(companies)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    async list(opts?: { status?: CompanyStatus }): Promise<Company[]> {
      if (opts?.status) {
        return db.select().from(companies).where(eq(companies.status, opts.status)).all();
      }
      return db.select().from(companies).all();
    },

    async get(id: number): Promise<Company | undefined> {
      return db.select().from(companies).where(eq(companies.id, id)).get();
    },

    async getBySlug(slug: string): Promise<Company | undefined> {
      return db.select().from(companies).where(eq(companies.slug, slug)).get();
    },

    /** Cheap check: does ANY company carry a taste score? (gates the fit sort). */
    async anyScored(): Promise<boolean> {
      const r = await db
        .select({ n: count() })
        .from(companies)
        .where(isNotNull(companies.scoreOverall))
        .get();
      return (r?.n ?? 0) > 0;
    },

    /**
     * Distinct conference verticals across all companies — for the people/company
     * filter dropdowns. `verticals` is a JSON-array text column, so we pull the
     * (few hundred) distinct raw values and flatten them in JS.
     */
    async verticalsList(): Promise<string[]> {
      const rows = await db.selectDistinct({ v: companies.verticals }).from(companies).all();
      const set = new Set<string>();
      for (const r of rows) {
        if (!r.v) continue;
        try {
          for (const x of JSON.parse(r.v) as unknown[]) if (typeof x === "string") set.add(x);
        } catch {
          /* malformed verticals JSON → skip */
        }
      }
      return [...set].sort();
    },

    /**
     * Look up a company by its canonical identity (domain OR linkedin_url) —
     * the dedupe rule from ADR-0001. Used by the resolver to avoid colliding
     * with an already-resolved row. Null/undefined keys never match.
     */
    async findByIdentity(identity: {
      domain?: string | null;
      linkedinUrl?: string | null;
    }): Promise<Company | undefined> {
      const conds = [];
      if (identity.domain) conds.push(eq(companies.domain, identity.domain));
      if (identity.linkedinUrl) conds.push(eq(companies.linkedinUrl, identity.linkedinUrl));
      if (conds.length === 0) return undefined;
      return db
        .select()
        .from(companies)
        .where(conds.length === 1 ? conds[0] : or(...conds))
        .get();
    },

    async update(id: number, patch: CompanyPatch): Promise<Company | undefined> {
      return db
        .update(companies)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(companies.id, id))
        .returning()
        .get();
    },

    /**
     * Remove a company by id. Used by CSV import to roll back a row that, once
     * resolved, turns out to share a canonical identity with an existing
     * company (a cross-shape / re-import duplicate) — keeping import idempotent.
     */
    async delete(id: number): Promise<void> {
      await db.delete(companies).where(eq(companies.id, id)).run();
    },

    /**
     * Promote a company at least as far as `target` along the funnel
     * (`new` → `enriched` → `interesting` → …). Used by the job-first path:
     * marking a role interesting promotes its company `new` → `interesting`
     * (ADR-0001). A no-op (and idempotent) when the company is already at or
     * past `target`, so we never regress a `watching`/`pursuing` company.
     */
    async promoteToAtLeast(id: number, target: CompanyStatus): Promise<Company | undefined> {
      const company = await this.get(id);
      if (!company) return undefined;
      const current = COMPANY_STATUS.indexOf(company.status);
      const goal = COMPANY_STATUS.indexOf(target);
      // `passed` is a terminal sink, not an ordered milestone — never auto-advance
      // into it and never advance a company that has been explicitly passed.
      if (target === "passed" || company.status === "passed") return company;
      if (current >= goal) return company;
      return this.update(id, { status: target });
    },
  };
}

export type CompanyRepo = ReturnType<typeof createCompanyRepo>;

// --- roles repo (issue 07) ---

export type RoleInput = Omit<NewRole, "id" | "createdAt" | "updatedAt">;
export type RolePatch = Partial<Omit<NewRole, "id" | "createdAt" | "updatedAt">>;

/** A role joined with its company's display fields — one row of the explorer. */
export type RoleCardRow = Pick<
  Role,
  | "id"
  | "title"
  | "url"
  | "location"
  | "workType"
  | "salary"
  | "status"
  | "source"
  | "postedDate"
  | "lastSeenAt"
  | "updatedAt"
> & {
  companyName: string | null;
  companySlug: string | null;
  companyScore: number | null;
};

/**
 * The typed data layer for roles (job listings). All role reads/writes go
 * through here; no raw SQL elsewhere (ADR-0001). Roles always link to a company
 * (`companyId`), which may still be unenriched (`status: new`).
 */
export function createRoleRepo(db: DB) {
  return {
    async create(input: RoleInput): Promise<Role> {
      const ts = Date.now();
      return db
        .insert(roles)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    async list(opts?: { status?: RoleStatus; companyId?: number }): Promise<Role[]> {
      const conds = [];
      if (opts?.status) conds.push(eq(roles.status, opts.status));
      if (opts?.companyId !== undefined) conds.push(eq(roles.companyId, opts.companyId));
      const q = db.select().from(roles).$dynamic();
      if (conds.length === 1) q.where(conds[0]);
      else if (conds.length > 1) q.where(and(...conds));
      return q.orderBy(desc(roles.createdAt)).all();
    },

    async get(id: number): Promise<Role | undefined> {
      return db.select().from(roles).where(eq(roles.id, id)).get();
    },

    /**
     * One PAGE of the roles explorer — filtered, searched, sorted, and paginated
     * AT THE DB so a ~4.6k-role dataset never ships whole. Joins the company for
     * its name/slug/fit, searches title + location + company name, and returns
     * the page rows plus the total matching count (for the pager). Descriptions
     * aren't selected — the card links out to the live posting.
     */
    async listRolesPage(opts: {
      status?: string;
      workType?: string;
      q?: string;
      sort?: "posted" | "title" | "company" | "fit";
      dir?: "asc" | "desc";
      limit: number;
      offset: number;
    }): Promise<{ rows: RoleCardRow[]; total: number }> {
      const conds = [];
      if (opts.status && opts.status !== "all")
        conds.push(eq(roles.status, opts.status as RoleStatus));
      if (opts.workType && opts.workType !== "all")
        conds.push(eq(roles.workType, opts.workType as WorkType));
      const needle = opts.q?.trim();
      if (needle) {
        const pat = `%${needle}%`;
        conds.push(or(like(roles.title, pat), like(roles.location, pat), like(companies.name, pat)));
      }
      const where = conds.length === 1 ? conds[0] : conds.length ? and(...conds) : undefined;

      const dirFn = opts.dir === "asc" ? asc : desc;
      const sortCol =
        opts.sort === "title"
          ? roles.title
          : opts.sort === "company"
            ? companies.name
            : opts.sort === "fit"
              ? companies.scoreOverall
              : roles.postedDate;

      const rowsQ = db
        .select({
          id: roles.id,
          title: roles.title,
          url: roles.url,
          location: roles.location,
          workType: roles.workType,
          salary: roles.salary,
          status: roles.status,
          source: roles.source,
          postedDate: roles.postedDate,
          lastSeenAt: roles.lastSeenAt,
          updatedAt: roles.updatedAt,
          companyName: companies.name,
          companySlug: companies.slug,
          companyScore: companies.scoreOverall,
        })
        .from(roles)
        .leftJoin(companies, eq(roles.companyId, companies.id))
        .$dynamic();
      if (where) rowsQ.where(where);
      const rows = (await rowsQ
        .orderBy(dirFn(sortCol), desc(roles.postedDate))
        .limit(opts.limit)
        .offset(opts.offset)
        .all()) as RoleCardRow[];

      const countQ = db
        .select({ n: count() })
        .from(roles)
        .leftJoin(companies, eq(roles.companyId, companies.id))
        .$dynamic();
      if (where) countQ.where(where);
      const total = (await countQ.get())?.n ?? 0;

      return { rows, total };
    },

    /** Distinct, non-empty work types — for the explorer's location-type filter. */
    async roleWorkTypes(): Promise<string[]> {
      const rows = await db.selectDistinct({ workType: roles.workType }).from(roles).all();
      return rows
        .map((r) => r.workType)
        .filter((w): w is WorkType => Boolean(w) && w !== "unknown")
        .sort();
    },

    /**
     * Open-role count per company in ONE grouped query — avoids loading every
     * role row (with descriptions) just to count, which is expensive over a
     * remote (Turso) DB. Returns a Map keyed by companyId.
     */
    async countsByCompany(): Promise<Map<number, number>> {
      const rows = await db
        .select({ companyId: roles.companyId, n: count() })
        .from(roles)
        .groupBy(roles.companyId)
        .all();
      return new Map(rows.map((r) => [r.companyId, Number(r.n)]));
    },

    /**
     * Look up a role by the provider's job id — the job-board dedupe key
     * (roles.external_id, partial-unique where not null). A null/empty id never
     * matches, so id-less roles are never treated as duplicates.
     */
    async findByExternalId(externalId: string | null | undefined): Promise<Role | undefined> {
      if (!externalId) return undefined;
      return db.select().from(roles).where(eq(roles.externalId, externalId)).get();
    },

    async update(id: number, patch: RolePatch): Promise<Role | undefined> {
      return db
        .update(roles)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(roles.id, id))
        .returning()
        .get();
    },

    async delete(id: number): Promise<void> {
      await db.delete(roles).where(eq(roles.id, id)).run();
    },
  };
}

export type RoleRepo = ReturnType<typeof createRoleRepo>;
