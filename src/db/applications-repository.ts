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
    create(input: ApplicationInput): Application {
      const ts = Date.now();
      return db
        .insert(applications)
        .values({ ...input, createdAt: ts, updatedAt: ts })
        .returning()
        .get();
    },

    get(id: number): Application | undefined {
      return db
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .get();
    },

    list(opts?: { status?: ApplicationStatus }): Application[] {
      if (opts?.status) {
        return db
          .select()
          .from(applications)
          .where(eq(applications.status, opts.status))
          .all();
      }
      return db.select().from(applications).all();
    },

    update(id: number, patch: ApplicationPatch): Application | undefined {
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
    advance(
      id: number,
      to: ApplicationStatus,
      next?: { nextAction?: string | null; nextActionDate?: string | null },
    ): Application | undefined {
      const current = this.get(id);
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
    listWithContext(opts?: {
      status?: ApplicationStatus;
    }): ApplicationWithContext[] {
      const rows = db
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
    interestingNotContacted(opts?: {
      statuses?: Company["status"][];
    }): InterestingNotContacted[] {
      const interesting: Company["status"][] = opts?.statuses ?? [
        "interesting",
        "watching",
        "pursuing",
      ];

      // Companies that already have an application — exclude these.
      const engagedCompanyIds = db
        .select({ id: applications.companyId })
        .from(applications);

      const candidates = db
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
        const contacts = db
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
