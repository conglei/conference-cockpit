import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { DB } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";
import { createPersonRepo } from "../src/db/people-repository";
import { logMet, followupQueue, draftFollowup } from "../src/followup";

function seed(db: DB) {
  const companies = createCompanyRepo(db);
  const people = createPersonRepo(db);
  const co = companies.create({ slug: "yutori", name: "Yutori", status: "interesting" });
  const dhruv = people.create({ slug: "dhruv", name: "Dhruv Batra", companyId: co.id, relationship: "network_contact" });
  const solo = people.create({ slug: "nora", name: "Nora Stone", relationship: "network_contact" });
  return { companies, people, co, dhruv, solo };
}

const at = (t: number) => () => t;

describe("logMet", () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });

  it("stamps met + last_contacted_at + a default next action", () => {
    const { people, dhruv } = seed(db);
    const p = logMet({ people }, { personId: dhruv.id }, at(1000));
    expect(p.outreachStatus).toBe("met");
    expect(p.lastContactedAt).toBe(1000);
    expect(p.nextAction).toBe("send follow-up");
  });

  it("records a note into the next action", () => {
    const { people, dhruv } = seed(db);
    const p = logMet({ people }, { personId: dhruv.id, note: "agent evals", nextAction: "send repo" }, at(1));
    expect(p.nextAction).toContain("re: agent evals");
    expect(p.nextAction).toContain("send repo");
  });

  it("never regresses someone already further along the funnel", () => {
    const { people, dhruv } = seed(db);
    people.update(dhruv.id, { outreachStatus: "replied" });
    const p = logMet({ people }, { personId: dhruv.id }, at(2000));
    expect(p.outreachStatus).toBe("replied"); // not pulled back to "met"
    expect(p.lastContactedAt).toBe(2000); // but the touch is still stamped
  });

  it("throws on a missing person", () => {
    const { people } = seed(db);
    expect(() => logMet({ people }, { personId: 9999 })).toThrow(/no person/);
  });
});

describe("followupQueue", () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });

  it("lists only open follow-ups, newest-touched first, with company + draft", () => {
    const { people, companies, dhruv, solo } = seed(db);
    logMet({ people }, { personId: dhruv.id }, at(100));
    logMet({ people }, { personId: solo.id }, at(200));
    // A 'replied' person is closed → excluded.
    const closed = people.create({ slug: "x", name: "Closed Person", relationship: "network_contact" });
    people.update(closed.id, { outreachStatus: "replied" });

    const q = followupQueue({ people, companies });
    expect(q.map((i) => i.person.name)).toEqual(["Nora Stone", "Dhruv Batra"]); // newest first
    expect(q.find((i) => i.person.name === "Dhruv Batra")!.companyName).toBe("Yutori");
    expect(q[0].draft).toContain("Nora");
  });
});

describe("draftFollowup", () => {
  it("is a plain draft mentioning the person + company; never a send", () => {
    const draft = draftFollowup({
      person: { id: 1, name: "Dhruv Batra" } as any,
      companyName: "Yutori",
    });
    expect(draft).toContain("Dhruv");
    expect(draft).toContain("Yutori");
    expect(draft).toMatch(/great meeting you/i);
  });
});
