import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createPersonRepo } from "../src/db/people-repository";
import { ingestSpeakerProfiles, type SpeakerProfile } from "../src/speakers/ingest-profiles";

describe("ingestSpeakerProfiles", () => {
  it("matches by linkedin then name, sets bio/photo/twitter, reports unmatched", () => {
    const db = createTestDb();
    const people = createPersonRepo(db);
    const byLi = people.create({
      slug: "a",
      name: "Ada Lovelace",
      relationship: "network_contact",
      linkedinUrl: "https://www.linkedin.com/in/ada",
    });
    const byName = people.create({ slug: "g", name: "Grace Hopper", relationship: "network_contact" });

    const feed: SpeakerProfile[] = [
      { name: "Ada L.", linkedin: "https://linkedin.com/in/ada/", bio: "Math.", photoUrl: "/a.jpg" },
      { name: "Grace Hopper", bio: "Compilers.", twitter: "https://x.com/grace" },
      { name: "Nobody Here", bio: "ghost" },
    ];

    const res = ingestSpeakerProfiles({ people }, feed);

    expect(res.matched).toBe(2);
    expect(res.unmatched).toBe(1);
    expect(res.unmatchedNames).toEqual(["Nobody Here"]);
    expect(res.bioSet).toBe(2);
    expect(res.photoSet).toBe(1);
    expect(res.twitterSet).toBe(1);
    expect(people.get(byLi.id)!.bio).toBe("Math.");
    expect(people.get(byName.id)!.twitterUrl).toBe("https://x.com/grace");
  });

  it("never clobbers an existing value with a feed value", () => {
    const db = createTestDb();
    const people = createPersonRepo(db);
    const p = people.create({ slug: "p", name: "Pat", relationship: "network_contact" });
    people.update(p.id, { bio: "original" });

    const res = ingestSpeakerProfiles({ people }, [{ name: "Pat", bio: "replacement" }]);
    expect(res.bioSet).toBe(0);
    expect(people.get(p.id)!.bio).toBe("original");
  });
});
