import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { rollUpVerticals, isVerticalTrack } from "../src/talks/roll-up-verticals";

describe("isVerticalTrack", () => {
  it("keeps topical tracks", () => {
    expect(isVerticalTrack("AI in Healthcare")).toBe(true);
    expect(isVerticalTrack("Security")).toBe(true);
    expect(isVerticalTrack("Agentic Commerce")).toBe(true);
  });

  it("rejects logistical/format tracks and blanks", () => {
    expect(isVerticalTrack("Workshops Day 1")).toBe(false);
    expect(isVerticalTrack("Track 7")).toBe(false);
    expect(isVerticalTrack("Track M")).toBe(false);
    expect(isVerticalTrack("Main Stage")).toBe(false);
    expect(isVerticalTrack("Expo Stage 2")).toBe(false);
    expect(isVerticalTrack(null)).toBe(false);
    expect(isVerticalTrack("")).toBe(false);
  });
});

describe("rollUpVerticals", () => {
  it("writes distinct topical tracks per company, dropping logistical ones", async () => {
    const db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);

    const co = await companies.create({ slug: "abridge", name: "Abridge" });
    const sp = await people.create({ slug: "s", name: "Speaker", companyId: co.id, relationship: "founder" });
    // Two healthcare talks (dedupe) + one logistical track (dropped).
    await talks.createIgnore({ speakerId: sp.id, companyId: co.id, title: "A", time: "1", track: "AI in Healthcare" });
    await talks.createIgnore({ speakerId: sp.id, companyId: co.id, title: "B", time: "2", track: "AI in Healthcare" });
    await talks.createIgnore({ speakerId: sp.id, companyId: co.id, title: "C", time: "3", track: "Workshops Day 1" });
    await talks.createIgnore({ speakerId: sp.id, companyId: co.id, title: "D", time: "4", track: "Security" });

    const res = await rollUpVerticals({ companies, talks });

    expect(res.companiesUpdated).toBe(1);
    expect(res.distinctVerticals).toEqual(["AI in Healthcare", "Security"]);
    const updated = await companies.get(co.id);
    expect(JSON.parse(updated!.verticals!)).toEqual(["AI in Healthcare", "Security"]);
  });

  it("ignores talks with no company", async () => {
    const db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);
    const sp = await people.create({ slug: "s", name: "Speaker", relationship: "founder" });
    await talks.createIgnore({ speakerId: sp.id, companyId: null, title: "X", time: "1", track: "AI in Finance" });

    const res = await rollUpVerticals({ companies, talks });
    expect(res.companiesUpdated).toBe(0);
  });
});
