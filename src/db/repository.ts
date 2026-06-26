import { and, desc, eq, or } from "drizzle-orm";
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
