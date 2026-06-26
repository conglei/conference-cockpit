import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers";
import { createPersonRepo } from "../src/db/people-repository";
import { ingestSpeakerProfiles, type SpeakerProfile } from "../src/speakers/ingest-profiles";

describe("ingestSpeakerProfiles", () => {
  it("matches by linkedin then name, sets bio/photo/twitter, reports unmatched", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    const byLi = await people.create({
      slug: "a",
      name: "Ada Lovelace",
      relationship: "network_contact",
      linkedinUrl: "https://www.linkedin.com/in/ada",
    });
    const byName = await people.create({ slug: "g", name: "Grace Hopper", relationship: "network_contact" });

    const feed: SpeakerProfile[] = [
      { name: "Ada L.", linkedin: "https://linkedin.com/in/ada/", bio: "Math.", photoUrl: "/a.jpg" },
      { name: "Grace Hopper", bio: "Compilers.", twitter: "https://x.com/grace" },
      { name: "Nobody Here", bio: "ghost" },
    ];

    const res = await ingestSpeakerProfiles({ people }, feed);

    expect(res.matched).toBe(2);
    expect(res.unmatched).toBe(1);
    expect(res.unmatchedNames).toEqual(["Nobody Here"]);
    expect(res.bioSet).toBe(2);
    expect(res.photoSet).toBe(1);
    expect(res.twitterSet).toBe(1);
    expect((await people.get(byLi.id))!.bio).toBe("Math.");
    expect((await people.get(byName.id))!.twitterUrl).toBe("https://x.com/grace");
  });

  it("never clobbers an existing value with a feed value", async () => {
    const db = await createTestDb();
    const people = createPersonRepo(db);
    const p = await people.create({ slug: "p", name: "Pat", relationship: "network_contact" });
    await people.update(p.id, { bio: "original" });

    const res = await ingestSpeakerProfiles({ people }, [{ name: "Pat", bio: "replacement" }]);
    expect(res.bioSet).toBe(0);
    expect((await people.get(p.id))!.bio).toBe("original");
  });
});
