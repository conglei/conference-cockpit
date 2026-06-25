import { describe, it, expect } from "vitest";
import {
  parseAsOf,
  freshness,
  isThin,
  rankPenalty,
  formatChip,
  sourceLabel,
  makeProvenance,
  companyFundingProvenance,
  companyIdentityProvenance,
  roleProvenance,
  personProvenance,
  STALE_DAYS,
} from "../src/provenance";

const NOW = new Date("2026-06-25T00:00:00Z");

describe("parseAsOf — the three DB date shapes", () => {
  it("passes through finite epoch-ms numbers", () => {
    expect(parseAsOf(1782364417544)).toBe(1782364417544);
  });
  it("parses YYYY-MM-DD as UTC midnight (no tz drift)", () => {
    expect(parseAsOf("2026-05-01")).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });
  it("parses ISO-8601 strings (roles.posted_date)", () => {
    expect(parseAsOf("2026-06-08T15:36:42.000+00:00")).toBe(
      Date.parse("2026-06-08T15:36:42.000+00:00"),
    );
  });
  it("returns null for missing/garbage", () => {
    expect(parseAsOf(null)).toBeNull();
    expect(parseAsOf(undefined)).toBeNull();
    expect(parseAsOf("")).toBeNull();
    expect(parseAsOf("not a date")).toBeNull();
    expect(parseAsOf(NaN)).toBeNull();
  });
});

describe("freshness", () => {
  it("labels recent dates", () => {
    expect(freshness("2026-06-25", NOW).label).toBe("today");
    expect(freshness("2026-06-24", NOW).label).toBe("1d ago");
    expect(freshness("2026-06-20", NOW).label).toBe("5d ago");
  });
  it("labels month- and year-scale ages", () => {
    expect(freshness("2026-05-01", NOW).label).toBe("2mo ago");
    expect(freshness("2025-01-01", NOW).label).toBe("over a year ago");
    expect(freshness("2023-01-01", NOW).label).toBe("3y ago");
  });
  it("marks unknown + stale correctly", () => {
    expect(freshness(null, NOW)).toMatchObject({ ageDays: null, label: "unknown", stale: true });
    const old = new Date(NOW.getTime() - (STALE_DAYS + 5) * 86_400_000);
    expect(freshness(old.getTime(), NOW).stale).toBe(true);
    expect(freshness(NOW.getTime(), NOW).stale).toBe(false);
  });
  it("never returns negative age for future dates", () => {
    expect(freshness("2027-01-01", NOW).ageDays).toBe(0);
  });
});

describe("thin-signal rule", () => {
  it("fresh apollo funding is high-confidence, not thin", () => {
    const p = makeProvenance("apollo", "2026-05-01", NOW);
    expect(p.confidence).toBe("high");
    expect(isThin(p, NOW)).toBe(false);
    expect(rankPenalty(p, NOW)).toBe(1);
  });
  it("unknown date is thin and penalized hardest", () => {
    const p = makeProvenance("apollo", null, NOW);
    expect(p.confidence).toBe("thin");
    expect(isThin(p, NOW)).toBe(true);
    expect(rankPenalty(p, NOW)).toBe(0.5);
  });
  it("stale date is thin with a softer penalty than unknown", () => {
    const stale = new Date(NOW.getTime() - (STALE_DAYS + 10) * 86_400_000);
    const p = makeProvenance("apollo", stale.getTime(), NOW);
    expect(isThin(p, NOW)).toBe(true);
    expect(rankPenalty(p, NOW)).toBe(0.7);
  });
  it("low-confidence source (manual) is thin even when freshly dated", () => {
    const p = makeProvenance("manual", NOW.getTime(), NOW);
    expect(p.confidence).toBe("thin");
    expect(rankPenalty(p, NOW)).toBe(0.6);
  });
});

describe("rendering", () => {
  it("sourceLabel maps known keys and title-cases unknown ones", () => {
    expect(sourceLabel("apollo")).toBe("Apollo");
    expect(sourceLabel("startups_gallery")).toBe("startups.gallery");
    expect(sourceLabel("weird_source")).toBe("Weird Source");
  });
  it("formatChip renders source + as-of", () => {
    expect(formatChip(makeProvenance("apollo", "2026-06-20", NOW), NOW)).toBe(
      "Apollo · as of 5d ago",
    );
    expect(formatChip(makeProvenance("apollo", null, NOW), NOW)).toBe(
      "Apollo · date unknown",
    );
  });
});

describe("per-entity derivation", () => {
  it("funding traces to Apollo dated by the funding date, not the import source", () => {
    const c = { source: "csv", lastFundingDate: "2026-05-01", updatedAt: NOW.getTime() };
    const p = companyFundingProvenance(c, NOW);
    expect(p.source).toBe("apollo");
    expect(formatChip(p, NOW)).toBe("Apollo · as of 2mo ago");
  });
  it("identity traces to the import/resolve source", () => {
    const c = { source: "csv", updatedAt: NOW.getTime() };
    expect(companyIdentityProvenance(c, NOW).source).toBe("csv");
  });
  it("role provenance prefers posted-date then last-seen", () => {
    const r = { source: "apollo", postedDate: "2026-06-08T15:36:42.000+00:00", lastSeenAt: "2026-06-24T00:00:00Z" };
    expect(roleProvenance(r, NOW).asOf).toBe("2026-06-08T15:36:42.000+00:00");
    expect(roleProvenance({ source: "ats", lastSeenAt: "2026-06-24T00:00:00Z" }, NOW).asOf).toBe(
      "2026-06-24T00:00:00Z",
    );
  });
  it("person provenance is the conference directory", () => {
    expect(personProvenance({ updatedAt: NOW.getTime() }, NOW).source).toBe("directory");
  });
});
