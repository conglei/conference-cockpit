import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Guards the committed forkable demo fixture (seed/demo-snapshot.json): it must
 * stay non-empty, rankable, privacy-safe, and demo-complete — so a fresh clone's
 * `pnpm seed-demo` always produces a working plan.
 */
describe("demo snapshot fixture", () => {
  const snap = JSON.parse(readFileSync("seed/demo-snapshot.json", "utf8"));

  it("has all four entity sets, non-empty", () => {
    for (const t of ["companies", "people", "talks", "roles"]) {
      expect(Array.isArray(snap[t]), t).toBe(true);
      expect(snap[t].length, t).toBeGreaterThan(0);
    }
  });

  it("is clean — carries NO persisted taste scores (the engine ranks neutrally)", () => {
    for (const c of snap.companies) {
      for (const k of ["score_overall", "score_founder_quality", "score_domain_fit", "score_rationale"])
        expect(c, c.slug).not.toHaveProperty(k);
    }
  });

  it("is demo-complete — the WHOLE graph, including every job", () => {
    // A fresh clone's `pnpm seed-demo` must yield the entire conference, not a
    // scored subset — all companies, people, and ALL roles (not just surfaced).
    expect(snap.companies.length).toBeGreaterThanOrEqual(200);
    expect(snap.people.length).toBeGreaterThanOrEqual(400);
    expect(snap.roles.length).toBeGreaterThanOrEqual(1000);
  });

  it("carries the public people profile the detail pages render", () => {
    const withBio = snap.people.filter((p: { bio: string | null; about: string | null }) => p.bio || p.about);
    const withPhoto = snap.people.filter((p: { photo_url: string | null }) => p.photo_url);
    expect(withBio.length).toBeGreaterThan(snap.people.length * 0.5);
    expect(withPhoto.length).toBeGreaterThan(snap.people.length * 0.5);
  });

  it("is privacy-safe — no scraped blobs / verdicts / notes / CRM leaked", () => {
    const forbidden = [
      "enrichment_blob", "score_verdict", "deep_dive_path", "notes_path",
      "linkedin_profile", "connection_degree", "can_refer", "outreach_status",
      "next_action", "last_contacted_at",
    ];
    for (const c of snap.companies) for (const k of forbidden) expect(c).not.toHaveProperty(k);
    for (const p of snap.people) for (const k of forbidden) expect(p).not.toHaveProperty(k);
  });

  it("is demo-complete — talks carry a time slot for who-to-meet logistics", () => {
    const withTime = snap.talks.filter((t: { time: string | null }) => t.time);
    expect(withTime.length).toBeGreaterThan(snap.talks.length * 0.8);
  });
});
