import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createPersonRepo } from "../src/db/people-repository";
import { createCompanyRepo } from "../src/db/repository";
import { createTalkRepo } from "../src/db/talk-repository";
import {
  extractBackground,
  rankPeople,
  CAREER_MOVER,
  LEARNER,
  getObjective,
  type PeopleGraph,
} from "../src/plan/who-to-meet";
import { loadPreferences } from "../src/scoring";

const profile = { ...loadPreferences("does-not-exist.md"), summary: undefined };
const NO_BG = { employers: [], schools: [] };
const NOW = new Date("2026-06-25");

async function graphFrom(db: Awaited<ReturnType<typeof createTestDb>>): Promise<PeopleGraph> {
  const companies = createCompanyRepo(db);
  const talks = createTalkRepo(db);
  const people = createPersonRepo(db);
  const byId = new Map((await companies.list()).map((c) => [c.id, c]));
  const allTalks = await talks.list();
  const talksBySpeaker = new Map<number, typeof allTalks>();
  for (const t of allTalks) {
    const list = talksBySpeaker.get(t.speakerId) ?? [];
    list.push(t);
    talksBySpeaker.set(t.speakerId, list);
  }
  return {
    people: await people.list(),
    companyById: (id) => (id == null ? undefined : byId.get(id)),
    talksBySpeaker: (id) => talksBySpeaker.get(id) ?? [],
  };
}

describe("extractBackground", () => {
  it("splits employers from schools on dash-delimited resume lines", () => {
    const bg = extractBackground(
      [
        "Software Engineer — Airbnb",
        "Research Staff Member — IBM Watson Research Center",
        "Ph.D. in Computer Science — The Hong Kong University of Science and Technology (2010 - 2014)",
      ].join("\n"),
    );
    expect(bg.employers).toContain("Airbnb");
    expect(bg.employers).toContain("IBM Watson Research Center");
    expect(bg.schools).toContain("The Hong Kong University of Science and Technology");
  });
});

describe("scorePerson pedigree", () => {
  it("credits a PAST top-lab employer but not the CURRENT one", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    // Currently at Anthropic, previously at OpenAI → "ex-OpenAI", never "ex-Anthropic".
    await people.create({
      slug: "a",
      name: "Ada",
      relationship: "network_contact",
      currentCompany: "Anthropic",
      headline: "MTS at Anthropic",
      workHistory: JSON.stringify([
        { company: "Anthropic", title: "MTS", end: "Present" },
        { company: "OpenAI", title: "Researcher", end: "2025" },
      ]),
    });
    const [p] = rankPeople({ graph: await graphFrom(db), profile, background: NO_BG, now: NOW });
    expect(p.pedigree).toContain("ex-OpenAI");
    expect(p.pedigree.join()).not.toContain("Anthropic");
  });

  it("adds a shared-employer warm path", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    await people.create({
      slug: "b",
      name: "Grace",
      relationship: "network_contact",
      currentCompany: "Stripe",
      workHistory: JSON.stringify([{ company: "Airbnb", title: "Eng", end: "2020" }]),
    });
    const [p] = rankPeople(
      { graph: await graphFrom(db), profile, background: { employers: ["Airbnb"], schools: [] }, now: NOW },
    );
    expect(p.warmPath.shared).toContain("worked at Airbnb");
  });
});

describe("intent / objective", () => {
  it("getObjective resolves presets and defaults to career-mover", () => {
    expect(getObjective("learner").key).toBe("learner");
    expect(getObjective("LEARNER").key).toBe("learner");
    expect(getObjective(undefined).key).toBe("career-mover");
    expect(getObjective("nonsense").key).toBe("career-mover");
  });

  it("Learner flips the order vs Career Mover: on-topic depth beats ex-FAANG pedigree", async () => {
    const db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);
    const hc = await companies.create({ slug: "hc", name: "HealthCo", verticals: JSON.stringify(["AI in Healthcare"]) });

    // Pedigree-strong but NOT on-topic (no healthcare talk).
    await people.create({
      slug: "p", name: "Pedigree Pat", relationship: "network_contact", companyId: hc.id,
      currentCompany: "HealthCo", headline: "Engineer",
      workHistory: JSON.stringify([{ company: "OpenAI", title: "Eng", end: "2024" }]),
    });
    // On-topic founder/researcher, no FAANG pedigree.
    const onTopic = await people.create({
      slug: "o", name: "OnTopic Olu", relationship: "network_contact", companyId: hc.id,
      currentCompany: "HealthCo", headline: "Founder & CEO",
    });
    await talks.createIgnore({ speakerId: onTopic.id, companyId: hc.id, title: "Clinical AI", time: "1", track: "AI in Healthcare" });

    const graph = await graphFrom(db);
    const cm = rankPeople(
      { graph, profile, background: NO_BG, now: NOW, objective: CAREER_MOVER },
      { vertical: "Healthcare" },
    );
    const ln = rankPeople(
      { graph, profile, background: NO_BG, now: NOW, objective: LEARNER },
      { vertical: "Healthcare" },
    );
    expect(cm[0].name).toBe("Pedigree Pat"); // founder-bar prizes ex-OpenAI
    expect(ln[0].name).toBe("OnTopic Olu"); // learner prizes on-topic depth
  });
});

describe("rankPeople filtering", () => {
  async function seed() {
    const db = await createTestDb();
    const companies = createCompanyRepo(db);
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);

    // Focused healthcare company.
    const abridge = await companies.create({
      slug: "abridge",
      name: "Abridge",
      verticals: JSON.stringify(["AI in Healthcare"]),
    });
    // Generalist lab: 6 verticals incl. healthcare (must NOT flood the vertical).
    const lab = await companies.create({
      slug: "lab",
      name: "BigLab",
      verticals: JSON.stringify([
        "AI in Healthcare", "Security", "Inference", "Evals", "Graphs", "Voice & Realtime AI",
      ]),
    });

    const focused = await people.create({ slug: "f", name: "Focused Fiona", relationship: "network_contact", companyId: abridge.id });
    const labHealth = await people.create({ slug: "lh", name: "Lab Healther", relationship: "network_contact", companyId: lab.id });
    const labOther = await people.create({ slug: "lo", name: "Lab Otto", relationship: "network_contact", companyId: lab.id });

    // Focused person speaks in healthcare; lab person speaks healthcare too;
    // lab-other speaks Security (should be excluded from a healthcare filter).
    await talks.createIgnore({ speakerId: focused.id, companyId: abridge.id, title: "A", time: "1", track: "AI in Healthcare" });
    await talks.createIgnore({ speakerId: labHealth.id, companyId: lab.id, title: "B", time: "2", track: "AI in Healthcare" });
    await talks.createIgnore({ speakerId: labOther.id, companyId: lab.id, title: "C", time: "3", track: "Security" });
    return db;
  }

  it("vertical filter keeps own-talk matches and focused companies, drops generalist-by-association", async () => {
    const ranked = rankPeople(
      { graph: await graphFrom(await seed()), profile, background: NO_BG, now: NOW },
      { vertical: "Healthcare" },
    );
    const names = ranked.map((p) => p.name);
    expect(names).toContain("Focused Fiona"); // focused company + own healthcare talk
    expect(names).toContain("Lab Healther"); // own talk is in healthcare
    expect(names).not.toContain("Lab Otto"); // generalist company, own talk is Security
  });

  it("speakingOnly keeps only people with a talk, and limit caps the list", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    const talks = createTalkRepo(db);
    const s = await people.create({ slug: "s", name: "Speaker", relationship: "network_contact" });
    await people.create({ slug: "n", name: "NonSpeaker", relationship: "network_contact" });
    await talks.createIgnore({ speakerId: s.id, companyId: null, title: "T", time: "1", track: "Evals" });

    const graph = await graphFrom(db);
    const ranked = rankPeople({ graph, profile, background: NO_BG, now: NOW }, { speakingOnly: true });
    expect(ranked.map((p) => p.name)).toEqual(["Speaker"]);

    const capped = rankPeople({ graph, profile, background: NO_BG, now: NOW }, { limit: 1 });
    expect(capped).toHaveLength(1);
  });
});
