import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { createTalkRepo } from "../src/db/talk-repository";
import { ingestTalks, type AgendaSpeaker } from "../src/talks/ingest";

function seedPeople(db: DB) {
  const companies = createCompanyRepo(db);
  const people = createPersonRepo(db);
  const yutori = companies.create({ slug: "yutori", name: "Yutori", status: "interesting" });
  const dhruv = people.create({
    slug: "dhruv-batra",
    name: "Dhruv Batra",
    companyId: yutori.id,
    relationship: "network_contact",
    linkedinUrl: "https://www.linkedin.com/in/dhruvbatra",
  });
  const noLi = people.create({
    slug: "sara-hooker",
    name: "Sara Hooker",
    relationship: "network_contact",
  });
  return { yutori, dhruv, noLi };
}

const AGENDA: AgendaSpeaker[] = [
  {
    name: "Dhruv Batra",
    company: "Yutori",
    linkedin: "https://linkedin.com/in/dhruvbatra/", // differs by host/trailing slash
    sessions: [
      { title: "Computer-use models", day: "Day 3", time: "10:45am", room: "Track 7", track: "Computer Use", type: "talk" },
    ],
  },
  {
    name: "Sara Hooker", // no linkedin → matched by name
    sessions: [{ title: "Gradient-Free Continual Learning", time: "1:30pm", track: "Memory" }],
  },
  {
    name: "Nobody Here",
    linkedin: "https://linkedin.com/in/nobody",
    sessions: [{ title: "Ghost talk" }],
  },
  {
    name: "Dhruv Batra",
    linkedin: "https://linkedin.com/in/dhruvbatra/",
    sessions: [{ title: "" }], // no title → skipped
  },
];

describe("ingestTalks", () => {
  let db: DB;
  let seeded: ReturnType<typeof seedPeople>;
  beforeEach(() => {
    db = createTestDb();
    seeded = seedPeople(db);
  });

  function run() {
    return ingestTalks(
      { people: createPersonRepo(db), talks: createTalkRepo(db) },
      AGENDA,
      { sourceDetail: "test_conf" },
    );
  }

  it("matches by linkedin (host/slash-insensitive) and by name; reports unmatched", () => {
    const r = run();
    expect(r.speakersMatched).toBe(3); // two Dhruv entries + Sara
    expect(r.speakersUnmatched).toBe(1);
    expect(r.unmatchedNames).toEqual(["Nobody Here"]);
  });

  it("inserts talks, skips title-less sessions, denormalizes the company", () => {
    const r = run();
    expect(r.talksInserted).toBe(2); // Dhruv's + Sara's; ghost speaker + empty title excluded
    expect(r.sessionsSkippedNoTitle).toBe(1);
    const talks = createTalkRepo(db);
    const dhruvTalks = talks.bySpeaker(seeded.dhruv.id);
    expect(dhruvTalks).toHaveLength(1);
    expect(dhruvTalks[0]).toMatchObject({
      title: "Computer-use models",
      time: "10:45am",
      room: "Track 7",
      companyId: seeded.yutori.id, // denormalized off the speaker
    });
    // Speaker with no company → talk.companyId null, but still ingested.
    expect(talks.bySpeaker(seeded.noLi.id)[0].companyId).toBeNull();
  });

  it("is idempotent — re-running ingests nothing new", () => {
    run();
    const second = run();
    expect(second.talksInserted).toBe(0);
    expect(second.talksDuplicate).toBe(2);
    expect(createTalkRepo(db).count()).toBe(2);
  });
});
