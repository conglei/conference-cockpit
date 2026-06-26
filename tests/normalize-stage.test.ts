import { describe, it, expect } from "vitest";
import { normalizeStage } from "../src/providers/normalize-stage";

describe("normalizeStage (funding round → clean company stage)", () => {
  it("maps clean fundraising rounds", () => {
    expect(normalizeStage("Seed")).toBe("Seed");
    expect(normalizeStage("Pre-Seed")).toBe("Pre-Seed");
    expect(normalizeStage("pre seed")).toBe("Pre-Seed");
    expect(normalizeStage("Series A")).toBe("Series A");
    expect(normalizeStage("series e")).toBe("Series E");
    expect(normalizeStage("Angel")).toBe("Angel");
  });

  it("returns null for non-fundraising events (no fabricated stage)", () => {
    expect(normalizeStage("Venture (Round not Specified)")).toBeNull();
    expect(normalizeStage("Merger / Acquisition")).toBeNull();
    expect(normalizeStage("Debt Financing")).toBeNull();
    expect(normalizeStage("Other")).toBeNull();
    expect(normalizeStage("IPO")).toBeNull();
  });

  it("handles empty/null input", () => {
    expect(normalizeStage(null)).toBeNull();
    expect(normalizeStage(undefined)).toBeNull();
    expect(normalizeStage("")).toBeNull();
  });
});
