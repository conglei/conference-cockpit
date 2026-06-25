import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createPersonRepo } from "../src/db/people-repository";
import { enrichPerson, profileToPatch } from "../src/enrich/enrich-person";
import type { EnrichmentProvider, Profile } from "../src/providers/types";

// A realistic harvest-shaped profile (the fields profileToPatch reads).
const LOVEJOY: Profile = {
  name: "Christopher Lovejoy, MD",
  linkedinUrl: "https://linkedin.com/in/dr-christopher-lovejoy",
  title: "Member of Technical Staff at Anthropic",
  company: "Anthropic",
  location: "United Kingdom",
  raw: {
    headline: "Member of Technical Staff at Anthropic",
    about: "Doctor turned AI engineer.",
    experience: [
      { companyName: "Anthropic", position: "MTS", startDate: { text: "2026" }, endDate: { text: "Present" } },
      { companyName: "Anterior", position: "Head of Clinical AI", startDate: { year: 2024 }, endDate: { text: "2025" } },
      { position: "Hobby project" }, // no company, still kept (has a title)
      {}, // dropped: neither company nor title
    ],
    education: [
      { schoolName: "University of Cambridge", degree: "MB BChir", fieldOfStudy: "Medicine" },
      { degree: "no school" }, // dropped: no school
    ],
  },
};

describe("profileToPatch", () => {
  it("flattens headline/location/about/current + work history + education", () => {
    const patch = profileToPatch(LOVEJOY);
    expect(patch.headline).toBe("Member of Technical Staff at Anthropic");
    expect(patch.location).toBe("United Kingdom");
    expect(patch.about).toBe("Doctor turned AI engineer.");
    expect(patch.currentCompany).toBe("Anthropic");

    const work = JSON.parse(patch.workHistory!);
    expect(work).toHaveLength(3); // empty entry dropped
    expect(work[0]).toEqual({ company: "Anthropic", title: "MTS", start: "2026", end: "Present" });
    expect(work[1].end).toBe("2025");
    expect(work[1].start).toBe("2024"); // numeric year coerced to text

    const edu = JSON.parse(patch.education!);
    expect(edu).toEqual([{ school: "University of Cambridge", degree: "MB BChir", field: "Medicine" }]);

    expect(typeof patch.profileEnrichedAt).toBe("number");
    expect(JSON.parse(patch.linkedinProfile!).headline).toBe("Member of Technical Staff at Anthropic");
  });

  it("falls back to the mapped title when raw has no headline, and tolerates empty raw", () => {
    const patch = profileToPatch({ name: "X", linkedinUrl: "u", title: "Eng", raw: {} });
    expect(patch.headline).toBe("Eng");
    expect(patch.workHistory).toBeUndefined();
    expect(patch.education).toBeUndefined();
  });
});

function fakeProvider(profile: Profile | (() => never)): EnrichmentProvider {
  return {
    name: "fake",
    async resolveCompany() {
      return { via: "fake" };
    },
    async getProfile() {
      if (typeof profile === "function") return profile();
      return profile;
    },
    async getEmployees() {
      return [];
    },
    async search() {
      return [];
    },
  };
}

describe("enrichPerson", () => {
  it("persists the deep profile onto the person row", async () => {
    const db = createTestDb();
    const people = createPersonRepo(db);
    const p = people.create({
      slug: "cl",
      name: "Christopher Lovejoy",
      relationship: "network_contact",
      linkedinUrl: "https://linkedin.com/in/dr-christopher-lovejoy",
    });

    const res = await enrichPerson({ people, provider: fakeProvider(LOVEJOY) }, p.id);
    expect(res.notes).toEqual([]);
    const row = people.get(p.id)!;
    expect(row.currentCompany).toBe("Anthropic");
    expect(JSON.parse(row.workHistory!)[1].company).toBe("Anterior");
    expect(row.profileEnrichedAt).toBeTruthy();
  });

  it("skips a person with no linkedin_url (note, no throw)", async () => {
    const db = createTestDb();
    const people = createPersonRepo(db);
    const p = people.create({ slug: "n", name: "No URL", relationship: "network_contact" });

    const res = await enrichPerson({ people, provider: fakeProvider(LOVEJOY) }, p.id);
    expect(res.notes[0]).toMatch(/no linkedin_url/);
    expect(people.get(p.id)!.profileEnrichedAt).toBeNull();
  });

  it("captures a provider error as a note rather than throwing", async () => {
    const db = createTestDb();
    const people = createPersonRepo(db);
    const p = people.create({
      slug: "e",
      name: "Errs",
      relationship: "network_contact",
      linkedinUrl: "https://linkedin.com/in/errs",
    });

    const provider = fakeProvider(() => {
      throw new Error("boom");
    });
    const res = await enrichPerson({ people, provider }, p.id);
    expect(res.notes[0]).toMatch(/boom/);
    expect(people.get(p.id)!.profileEnrichedAt).toBeNull();
  });
});
