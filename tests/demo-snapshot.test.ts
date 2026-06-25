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

  it("is rankable — at least 8 scored companies for a full plan", () => {
    const scored = snap.companies.filter((c: { score_overall: number | null }) => c.score_overall != null);
    expect(scored.length).toBeGreaterThanOrEqual(8);
  });

  it("is privacy-safe — no scraped blobs / verdicts / notes leaked", () => {
    const forbidden = ["enrichment_blob", "score_verdict", "deep_dive_path", "notes_path"];
    for (const c of snap.companies) for (const k of forbidden) expect(c).not.toHaveProperty(k);
    for (const p of snap.people) for (const k of forbidden) expect(p).not.toHaveProperty(k);
  });

  it("is demo-complete — talks carry a time slot for who-to-meet logistics", () => {
    const withTime = snap.talks.filter((t: { time: string | null }) => t.time);
    expect(withTime.length).toBeGreaterThan(snap.talks.length * 0.8);
  });
});
