import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { loadPreferences } from "../src/scoring";
import { planWhoToMeet } from "../src/plan/who-to-meet-plan";

// The orchestrator does I/O; inject profile/background so it never reads disk.
const deps = {
  profile: { ...loadPreferences("does-not-exist.md"), summary: undefined },
  background: { employers: [], schools: [] },
  now: new Date("2026-06-25"),
};

describe("planWhoToMeet (the people-first view seam, ADR-0004)", () => {
  let db: DB;

  beforeEach(async () => {
    db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);

    const acme = await companies.create({
      slug: "acme",
      name: "Acme",
      status: "new",
      verticals: JSON.stringify(["AI in Healthcare"]),
    });
    const other = await companies.create({
      slug: "other",
      name: "Other",
      status: "new",
      verticals: JSON.stringify(["Inference"]),
    });

    // Ada: ex-OpenAI (pedigree) + speaking → should rank top.
    const ada = await people.create({
      slug: "ada",
      name: "Ada Lovelace",
      companyId: acme.id,
      relationship: "network_contact",
      title: "Founding Engineer",
      photoUrl: "https://example.com/ada.jpg",
      workHistory: JSON.stringify([{ company: "OpenAI", end: "2023" }]),
    });
    await talks.createIgnore({
      speakerId: ada.id,
      companyId: acme.id,
      title: "Scaling clinical AI",
      time: "10:00",
      track: "AI in Healthcare",
    });
    // Bob: no pedigree, not speaking, and SAVED (targeted) to the list.
    await people.create({
      slug: "bob",
      name: "Bob Smith",
      companyId: other.id,
      relationship: "network_contact",
      title: "Engineer",
      outreachStatus: "targeted",
    });
  });

  it("ranks people directly and carries the company as an attribute", async () => {
    const view = await planWhoToMeet(db, {}, deps);
    expect(view.people[0].name).toBe("Ada Lovelace");
    expect(view.people[0].currentCompany).toBe("Acme");
    expect(view.people[0].pedigree).toContain("ex-OpenAI");
    expect(view.totalPeople).toBe(2);
  });

  it("derives the vertical facet (sorted, distinct) and the saved set", async () => {
    const view = await planWhoToMeet(db, {}, deps);
    expect(view.verticals).toEqual(["AI in Healthcare", "Inference"]);
    const bob = view.people.find((p) => p.slug === "bob");
    expect(view.savedIds.has(bob!.personId)).toBe(true);
    expect(view.savedIds.size).toBe(1);
  });

  it("carries photoUrl onto the planned atom (view never touches raw rows)", async () => {
    const view = await planWhoToMeet(db, {}, deps);
    const ada = view.people.find((p) => p.slug === "ada");
    expect(ada!.photoUrl).toBe("https://example.com/ada.jpg");
  });

  it("speakingOnly keeps only people with a talk slot", async () => {
    const view = await planWhoToMeet(db, { speakingOnly: true }, deps);
    expect(view.people.map((p) => p.slug)).toEqual(["ada"]);
  });

  it("savedOnly returns every saved person, regardless of rank depth", async () => {
    const view = await planWhoToMeet(db, { savedOnly: true }, deps);
    expect(view.people.map((p) => p.slug)).toEqual(["bob"]);
  });

  it("vertical filter scopes to the matching company/talk", async () => {
    const view = await planWhoToMeet(db, { vertical: "AI in Healthcare" }, deps);
    expect(view.people.map((p) => p.slug)).toEqual(["ada"]);
  });
});
