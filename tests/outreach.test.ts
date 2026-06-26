import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "./helpers";
import { createPersonRepo, type PersonRepo } from "../src/db/people-repository";
import {
  createApplicationRepo,
  type ApplicationRepo,
} from "../src/db/applications-repository";
import { createCompanyRepo } from "../src/db/repository";
import { roles } from "../src/db/schema";
import * as outreach from "../src/outreach";
import { logOutreach } from "../src/outreach";
import { readDeepDive } from "../src/enrich";
import type { DB } from "../src/db/client";

async function makePerson(repo: PersonRepo, slug: string, companyId?: number) {
  return repo.create({
    slug,
    name: slug,
    relationship: "founder",
    ...(companyId !== undefined ? { companyId } : {}),
  });
}

describe("logOutreach — the deterministic logging primitive", () => {
  let db: DB;
  let people: PersonRepo;
  let applications: ApplicationRepo;

  beforeEach(async () => {
    db = await createTestDb();
    people = createPersonRepo(db);
    applications = createApplicationRepo(db);
  });

  it("persists status + next-action on the person row", async () => {
    const p = await makePerson(people, "ada-lovelace");
    expect(p.outreachStatus).toBe("none");

    const { person } = await logOutreach(
      { people },
      {
        personId: p.id,
        status: "drafted",
        nextAction: "send via Claude-in-Chrome",
        nextActionDate: "2026-06-24",
      },
    );

    expect(person.outreachStatus).toBe("drafted");
    expect(person.nextAction).toBe("send via Claude-in-Chrome");
    expect(person.nextActionDate).toBe("2026-06-24");

    // Round-trips through the data layer, not just the returned row.
    expect((await people.get(p.id))?.outreachStatus).toBe("drafted");
  });

  it("does NOT stamp last_contacted_at for a pure 'drafted' log (nothing sent)", async () => {
    const p = await makePerson(people, "grace-hopper");
    const { person } = await logOutreach(
      { people },
      { personId: p.id, status: "drafted" },
    );
    expect(person.outreachStatus).toBe("drafted");
    expect(person.lastContactedAt).toBeNull();
  });

  it("stamps last_contacted_at when the status reflects an actual touch", async () => {
    const p = await makePerson(people, "linus");
    const { person } = await logOutreach(
      { people },
      { personId: p.id, status: "contacted" },
      () => 1_700_000_000_000,
    );
    expect(person.outreachStatus).toBe("contacted");
    expect(person.lastContactedAt).toBe(1_700_000_000_000);
  });

  it("honors an explicit contactedAt override (and null to skip)", async () => {
    const p = await makePerson(people, "margaret");
    const a = await logOutreach(
      { people },
      { personId: p.id, status: "contacted", contactedAt: 42 },
    );
    expect(a.person.lastContactedAt).toBe(42);

    const b = await logOutreach(
      { people },
      { personId: p.id, status: "replied", contactedAt: null },
    );
    expect(b.person.lastContactedAt).toBeNull();
  });

  it("clears next-action with null but leaves it untouched when omitted", async () => {
    const p = await makePerson(people, "katherine");
    await logOutreach(
      { people },
      { personId: p.id, status: "drafted", nextAction: "ping" },
    );
    // Omit nextAction → preserved.
    const kept = await logOutreach({ people }, { personId: p.id, status: "contacted" });
    expect(kept.person.nextAction).toBe("ping");
    // Pass null → cleared.
    const cleared = await logOutreach(
      { people },
      { personId: p.id, status: "replied", nextAction: null },
    );
    expect(cleared.person.nextAction).toBeNull();
  });

  it("advances the linked application's next-action in lockstep", async () => {
    const companies = createCompanyRepo(db);
    const c = await companies.create({ slug: "acme", name: "Acme", status: "pursuing" });
    const ts = Date.now();
    const r = await db
      .insert(roles)
      .values({
        companyId: c.id,
        title: "Founding Engineer",
        status: "interesting",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
    const p = await makePerson(people, "referrer-x", c.id);
    const app = await applications.create({
      roleId: r.id,
      companyId: c.id,
      contactPersonId: p.id,
    });

    const { person, application } = await logOutreach(
      { people, applications },
      {
        personId: p.id,
        status: "contacted",
        nextAction: "await warm intro",
        nextActionDate: "2026-07-01",
        applicationId: app.id,
      },
    );

    expect(person.outreachStatus).toBe("contacted");
    expect(application).not.toBeNull();
    expect(application?.nextAction).toBe("await warm intro");
    expect(application?.nextActionDate).toBe("2026-07-01");
    // The application's funnel status is NOT touched by outreach logging.
    expect(application?.status).toBe("interested");
  });

  it("throws loudly on a missing person or application", async () => {
    await expect(
      logOutreach({ people }, { personId: 999, status: "drafted" }),
    ).rejects.toThrow(/no person/);

    const p = await makePerson(people, "real-person");
    await expect(
      logOutreach(
        { people, applications },
        { personId: p.id, status: "contacted", applicationId: 999 },
      ),
    ).rejects.toThrow(/no application/);

    await expect(
      logOutreach(
        { people },
        { personId: p.id, status: "contacted", applicationId: 1 },
      ),
    ).rejects.toThrow(/no applications repo/);
  });
});

/**
 * Drafting is the SKILL's judgment, not code — but the skill's *inputs* are
 * deterministic file reads. This test pins the documented contract: a draft is
 * grounded in the user's narrative + the target's deep-dive, both read via the
 * existing `readDeepDive` primitive, and the logging primitive records the
 * outcome. Critically: NO send path is invoked anywhere in the flow.
 */
describe("reach-out skill contract — inputs + no-send", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reach-out-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("draft inputs (narrative + target deep-dive) are readable; logging records the outcome with no send", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);

    // The two documented inputs the skill grounds a draft in.
    writeFileSync(
      join(dir, "narrative.md"),
      "# Narrative\nI build agentic data systems and want a founding role.",
    );
    writeFileSync(
      join(dir, "founder.md"),
      "# Jane Founder\nBuilding an AI eval platform; ex-research.",
    );

    const narrative = readDeepDive("narrative.md", dir);
    const deepDive = readDeepDive("founder.md", dir);
    expect(narrative).toContain("founding role");
    expect(deepDive).toContain("AI eval platform");

    // The agent/human would now draft from these two inputs (judgment, in the
    // skill). Once the USER sends it via Claude-in-Chrome, we log the outcome.
    const p = await people.create({
      slug: "jane-founder",
      name: "Jane Founder",
      relationship: "founder",
    });
    const { person } = await logOutreach(
      { people },
      {
        personId: p.id,
        status: "drafted",
        nextAction: "send cold founder-note via Claude-in-Chrome",
      },
    );

    expect(person.outreachStatus).toBe("drafted");
    expect(person.nextAction).toMatch(/Claude-in-Chrome/);

    // There is NO send path: the outreach module exports only a logger.
    for (const key of Object.keys(outreach)) {
      expect(key.toLowerCase()).not.toMatch(/send|email|smtp|deliver/);
    }
    expect(typeof outreach.logOutreach).toBe("function");
  });
});
