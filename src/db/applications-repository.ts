import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { DB } from "./client";
import {
  applications,
  companies,
  people,
  roles,
  type Application,
  type ApplicationStatus,
  type Company,
  type NewApplication,
  type Person,
  type Role,
} from "./schema";

// Fields the caller provides; id/timestamps are managed by the data layer.
export type ApplicationInput = Omit<
  NewApplication,
  "id" | "createdAt" | "updatedAt"
>;
export type ApplicationPatch = Partial<
  Omit<NewApplication, "id" | "createdAt" | "updatedAt">
>;

/** A row joined across the entities the pipeline cares about. */
export type ApplicationWithContext = {
  application: Application;
  role: Role;
  company: Company;
  contact: Person | null;
};

/** A company that's interesting on paper but hasn't entered the pipeline yet. */
export type InterestingNotContacted = {
  company: Company;
  /** Founders/referrers on file for this company (the people to reach out to). */
  contacts: Person[];
};

/**
 * The typed data layer for applications (issue 08). Kept in its own file to
 * avoid colliding with the parallel scoring work in `repository.ts`. All
 * application reads/writes go through here; no raw SQL elsewhere
 * (see docs/adr/0001-data-model.md).
 */
export function createApplicationRepo(db: DB) {
  return {
    async create(input: ApplicationInput): Promise<Application> {
      const ts = Date.now();
      return db
        .insert(applications)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    async get(id: number): Promise<Application | undefined> {
      return db
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .get();
    },

    async list(opts?: { status?: ApplicationStatus }): Promise<Application[]> {
      if (opts?.status) {
        return db
          .select()
          .from(applications)
          .where(eq(applications.status, opts.status))
          .all();
      }
      return db.select().from(applications).all();
    },

    async update(id: number, patch: ApplicationPatch): Promise<Application | undefined> {
      return db
        .update(applications)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(applications.id, id))
        .returning()
        .get();
    },

    /**
     * Move an application to a new status and (optionally) record the next
     * action. The *decision* of when to advance and what the next action is
     * lives in the `track` skill; this is the deterministic primitive it calls.
     * Sets `applied_at` the first time the application reaches `applied`.
     */
    async advance(
      id: number,
      to: ApplicationStatus,
      next?: { nextAction?: string | null; nextActionDate?: string | null },
    ): Promise<Application | undefined> {
      const current = await this.get(id);
      if (!current) return undefined;

      const patch: ApplicationPatch = { status: to };
      if (next && "nextAction" in next) patch.nextAction = next.nextAction ?? null;
      if (next && "nextActionDate" in next)
        patch.nextActionDate = next.nextActionDate ?? null;
      // Stamp applied_at the first time we cross into "applied" (idempotent).
      if (to === "applied" && current.appliedAt == null) {
        patch.appliedAt = Date.now();
      }
      return this.update(id, patch);
    },

    /** Full pipeline view: applications joined to role + company + contact. */
    async listWithContext(opts?: {
      status?: ApplicationStatus;
    }): Promise<ApplicationWithContext[]> {
      const rows = await db
        .select({
          application: applications,
          role: roles,
          company: companies,
          contact: people,
        })
        .from(applications)
        .innerJoin(roles, eq(applications.roleId, roles.id))
        .innerJoin(companies, eq(applications.companyId, companies.id))
        .leftJoin(people, eq(applications.contactPersonId, people.id))
        .where(opts?.status ? eq(applications.status, opts.status) : undefined)
        .all();
      return rows.map((r) => ({
        application: r.application,
        role: r.role,
        company: r.company,
        contact: r.contact ?? null,
      }));
    },

    /**
     * Cross-entity query spanning companies + people + roles + applications:
     * the "interesting + not-yet-contacted" slice. A company qualifies when it
     *
     *   - is in the funnel at `interesting` or later (`interesting`/`watching`/
     *     `pursuing`) — i.e. worth pursuing, not `new`/`enriched`/`passed`;
     *   - has at least one founder/referrer on file who can vouch for you
     *     (a person whose `relationship` is `founder` or `referrer`); and
     *   - has NO application yet (you haven't engaged the pipeline) and no
     *     contact has moved past `none` outreach (truly not-yet-contacted).
     *
     * Returns each such company together with the founders/referrers to reach.
     */
    async interestingNotContacted(opts?: {
      statuses?: Company["status"][];
    }): Promise<InterestingNotContacted[]> {
      const interesting: Company["status"][] = opts?.statuses ?? [
        "interesting",
        "watching",
        "pursuing",
      ];

      // Companies that already have an application — exclude these. This is a
      // subquery (a query builder, not a result), so it is NOT awaited here.
      const engagedCompanyIds = db
        .select({ id: applications.companyId })
        .from(applications);

      const candidates = await db
        .select()
        .from(companies)
        .where(
          and(
            inArray(companies.status, interesting),
            notInArray(companies.id, engagedCompanyIds),
          ),
        )
        .all();

      const result: InterestingNotContacted[] = [];
      for (const company of candidates) {
        // Founders/referrers on file who have NOT been contacted yet.
        const contacts = await db
          .select()
          .from(people)
          .where(
            and(
              eq(people.companyId, company.id),
              inArray(people.relationship, ["founder", "referrer"]),
              eq(people.outreachStatus, "none"),
            ),
          )
          .all();
        if (contacts.length > 0) result.push({ company, contacts });
      }
      return result;
    },
  };
}

export type ApplicationRepo = ReturnType<typeof createApplicationRepo>;
