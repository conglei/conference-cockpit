import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import {
  createApplicationRepo,
  type ApplicationRepo,
} from "../src/db/applications-repository";
import { createCompanyRepo } from "../src/db/repository";
import { companies, roles } from "../src/db/schema";
import type { DB } from "../src/db/client";
import {
  track,
  setNextAction,
  allowedTransitions,
  canTransition,
  isTerminal,
} from "../src/track";

/** Seed a company + role and return the role id (applications need a role). */
async function seedRole(db: DB, slug = "acme"): Promise<{ companyId: number; roleId: number }> {
  const company = await createCompanyRepo(db).create({ slug, name: slug });
  const ts = Date.now();
  const role = await db
    .insert(roles)
    .values({
      companyId: company.id,
      title: "Founding Engineer",
      status: "interesting",
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
  return { companyId: company.id, roleId: role.id };
}

describe("application lifecycle (transitions)", () => {
  it("offers forward + off-ramp transitions from interested", () => {
    expect(allowedTransitions("interested").sort()).toEqual(
      ["applied", "referred", "rejected", "withdrawn"].sort(),
    );
  });

  it("treats rejected and withdrawn as terminal", () => {
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("withdrawn")).toBe(true);
    expect(allowedTransitions("rejected")).toEqual([]);
    expect(allowedTransitions("offer")).toEqual(["rejected", "withdrawn"]);
  });

  it("validates legal vs illegal moves", () => {
    expect(canTransition("interested", "applied")).toBe(true);
    expect(canTransition("applied", "screening")).toBe(true);
    expect(canTransition("referred", "screening")).toBe(true);
    expect(canTransition("screening", "interviewing")).toBe(true);
    expect(canTransition("interviewing", "offer")).toBe(true);
    // illegal: skipping stages, going backwards, or self-transition
    expect(canTransition("interested", "interviewing")).toBe(false);
    expect(canTransition("interviewing", "applied")).toBe(false);
    expect(canTransition("applied", "applied")).toBe(false);
    expect(canTransition("rejected", "applied")).toBe(false);
  });
});

describe("track flow", () => {
  let db: DB;
  let repo: ApplicationRepo;
  let roleId: number;
  let companyId: number;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createApplicationRepo(db);
    ({ roleId, companyId } = await seedRole(db));
  });

  it("advances status and records the next action", async () => {
    const app = await repo.create({ roleId, companyId });
    expect(app.status).toBe("interested"); // default

    const res = await track(repo, app.id, "applied", {
      nextAction: "Send follow-up email",
      nextActionDate: "2026-07-01",
    });
    expect(res.from).toBe("interested");
    expect(res.to).toBe("applied");
    expect(res.application.status).toBe("applied");
    expect(res.application.nextAction).toBe("Send follow-up email");
    expect(res.application.nextActionDate).toBe("2026-07-01");
  });

  it("stamps applied_at once, the first time it reaches applied", async () => {
    const app = await repo.create({ roleId, companyId });
    expect(app.appliedAt).toBeNull();

    const applied = (await track(repo, app.id, "applied")).application;
    expect(applied.appliedAt).toBeGreaterThan(0);
    const stampedAt = applied.appliedAt;

    // moving forward does not re-stamp applied_at
    const screening = (await track(repo, app.id, "screening")).application;
    expect(screening.appliedAt).toBe(stampedAt);
  });

  it("rejects an illegal transition without mutating the row", async () => {
    const app = await repo.create({ roleId, companyId });
    await expect(track(repo, app.id, "offer")).rejects.toThrow(/Illegal status/);
    expect((await repo.get(app.id))?.status).toBe("interested");
  });

  it("throws on a missing application", async () => {
    await expect(track(repo, 999, "applied")).rejects.toThrow(/No application/);
  });

  it("setNextAction records an action without advancing status", async () => {
    const app = await repo.create({ roleId, companyId, status: "screening" });
    const updated = await setNextAction(repo, app.id, {
      nextAction: "Prep system-design round",
      nextActionDate: "2026-07-10",
    });
    expect(updated.status).toBe("screening");
    expect(updated.nextAction).toBe("Prep system-design round");
  });

  it("supports the referred entry path into screening", async () => {
    const app = await repo.create({ roleId, companyId });
    await track(repo, app.id, "referred");
    const res = await track(repo, app.id, "screening");
    expect(res.application.status).toBe("screening");
  });
});
