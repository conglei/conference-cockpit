import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createCompanyRepo, createRoleRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { buildPlan, loadGraph, careerMoverLens, getLens } from "../src/plan";
import type { GoalProfile } from "../src/plan";
import { DEFAULT_WEIGHTS } from "../src/scoring";

const NOW = new Date("2026-06-25T00:00:00Z");
const PROFILE: GoalProfile = {
  weights: DEFAULT_WEIGHTS,
  prefilter: { stages: [], locations: [], categories: [], sizeBands: [] },
  summary: "Founding engineer, agents.",
};

function scoredCompany(
  db: DB,
  slug: string,
  sub: { f?: number; i?: number; d?: number; rationale?: string; round?: string; fundDate?: string },
) {
  return createCompanyRepo(db).create({
    slug,
    name: slug,
    domain: `${slug}.ai`,
    status: "interesting",
    scoreFounderQuality: sub.f ?? null,
    scoreInvestorQuality: sub.i ?? null,
    scoreDomainFit: sub.d ?? null,
    scoreOverall: 0.5,
    scoreRationale: sub.rationale ?? null,
    scoredAt: NOW.getTime(),
    latestRound: sub.round ?? null,
    lastFundingDate: sub.fundDate ?? null,
  });
}

describe("careerMoverLens + buildPlan", () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });

  it("ranks by recombined sub-scores; excludes unscored companies", () => {
    scoredCompany(db, "elite", { f: 0.9, i: 0.9, d: 0.9, rationale: "Ex-DeepMind founders" });
    scoredCompany(db, "weak", { f: 0.2, i: 0.2, d: 0.2 });
    // No sub-scores AND no positive overall → excluded.
    createCompanyRepo(db).create({ slug: "unscored", name: "unscored", status: "new", scoreOverall: null });

    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW });
    expect(plan.companies.map((c) => c.name)).toEqual(["elite", "weak"]);
    expect(plan.consideredCompanies).toBe(2);
    expect(plan.companies[0].score).toBeGreaterThan(plan.companies[1].score);
  });

  it("why-line leads with fit; timing clause only when the raise is recent + sourced", () => {
    scoredCompany(db, "fresh", { f: 0.9, i: 0.9, d: 0.9, round: "Series A", fundDate: "2026-05-01" });
    scoredCompany(db, "stale", { f: 0.9, i: 0.9, d: 0.9, round: "Series B", fundDate: "2024-01-01" });

    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW });
    const fresh = plan.companies.find((c) => c.name === "fresh")!;
    const stale = plan.companies.find((c) => c.name === "stale")!;
    expect(fresh.whyLine).toMatch(/^Elite founders/);
    expect(fresh.whyLine).toMatch(/raised Series A/);
    // Old raise is NOT presented as a timing signal.
    expect(stale.whyLine).not.toMatch(/raised/);
  });

  it("every claim carries provenance; funding traces to Apollo, rationale to taste review", () => {
    scoredCompany(db, "acme", { f: 0.9, i: 0.8, d: 0.8, rationale: "good", round: "Seed", fundDate: "2026-05-01" });
    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW });
    const claims = plan.companies[0].claims;
    expect(claims.every((c) => c.provenance && c.provenance.source)).toBe(true);
    expect(claims.find((c) => c.label === "Funding")!.provenance.source).toBe("apollo");
    expect(claims.find((c) => c.label.startsWith("Why"))!.provenance.source).toBe("llm");
  });

  it("nests who-to-meet: speakers first, with talk slot; opener references the speaker", () => {
    const c = scoredCompany(db, "yutori", { f: 0.9, i: 0.8, d: 0.9, rationale: "elite" });
    const people = createPersonRepo(db);
    const nonSpeaker = people.create({ slug: "p1", name: "Quiet Person", companyId: c.id, relationship: "network_contact" });
    const speaker = people.create({ slug: "dhruv", name: "Dhruv Batra", companyId: c.id, relationship: "network_contact", title: "Founder" });
    void nonSpeaker;
    createTalkRepo(db).createIgnore({
      speakerId: speaker.id, companyId: c.id, title: "Computer-use models",
      day: "Day 3", time: "10:45am", room: "Track 7", source: "manual",
    });

    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW });
    const planned = plan.companies[0];
    expect(planned.whoToMeet[0].name).toBe("Dhruv Batra"); // speaker sorted first
    expect(planned.whoToMeet[0].speaking).toBe(true);
    expect(planned.whoToMeet[0].talk?.time).toBe("10:45am");
    expect(planned.talkLogistics[0]).toContain("Dhruv Batra speaks");
    expect(planned.opener).toContain("Dhruv");
    expect(planned.opener).toContain("Computer-use models");
  });

  it("hiring garnish: open roles boost score and surface as claims + openRoles", () => {
    const c = scoredCompany(db, "hiring", { f: 0.8, i: 0.8, d: 0.8 });
    const roles = createRoleRepo(db);
    roles.create({ companyId: c.id, title: "Founding Engineer", status: "new", source: "apollo", postedDate: "2026-06-10T00:00:00Z" });
    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW });
    expect(plan.companies[0].openRoles[0].title).toBe("Founding Engineer");
    expect(plan.companies[0].whyLine).toMatch(/1 open role/);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 12; i++) scoredCompany(db, `c${i}`, { f: 0.5 + i * 0.01, i: 0.5, d: 0.5 });
    const plan = buildPlan({ lens: careerMoverLens, profile: PROFILE, graph: loadGraph(db), now: NOW, limit: 5 });
    expect(plan.companies).toHaveLength(5);
  });

  it("exposes the lens registry seam", () => {
    expect(getLens("career-mover")).toBe(careerMoverLens);
    expect(getLens("nonexistent")).toBeUndefined();
  });
});
