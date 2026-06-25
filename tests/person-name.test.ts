import { describe, it, expect } from "vitest";
import {
  looksLikeOrgNoise,
  isPlausiblePersonName,
  isCompanyNameAsPerson,
} from "../src/enrich/person-name";

describe("looksLikeOrgNoise (roster-grade guard, issue #32)", () => {
  it("drops org-token strings", () => {
    expect(looksLikeOrgNoise("Information Security", "Acme")).toBe(true);
  });

  it("drops pure role/title phrases", () => {
    expect(looksLikeOrgNoise("Co Founder", "Acme")).toBe(true);
    expect(looksLikeOrgNoise("Co-Founder", "Acme")).toBe(true);
    expect(looksLikeOrgNoise("Chief Information", "Acme")).toBe(true);
    expect(looksLikeOrgNoise("Founder", "Acme")).toBe(true);
    expect(looksLikeOrgNoise("CEO", "Acme")).toBe(true);
    expect(looksLikeOrgNoise("CTO", "Acme")).toBe(true);
  });

  it("drops the company name parsed as a person (and + corp suffix)", () => {
    expect(looksLikeOrgNoise("Arcade", "Arcade")).toBe(true);
    expect(looksLikeOrgNoise("Arcade Software", "Arcade")).toBe(true);
    expect(looksLikeOrgNoise("Giga Co", "Giga")).toBe(true);
  });

  it("keeps a normal full name", () => {
    expect(looksLikeOrgNoise("Charles Packer", "Letta")).toBe(false);
  });

  it("keeps a single-token mononym (roster precision, not strict)", () => {
    expect(looksLikeOrgNoise("Madonna", "Acme")).toBe(false);
  });

  it("keeps a non-Western full name", () => {
    expect(looksLikeOrgNoise("Esha Dinne", "Acme")).toBe(false);
  });
});

describe("isPlausiblePersonName (strict, web-search rung)", () => {
  it("accepts a two-token capitalized name", () => {
    expect(isPlausiblePersonName("Jane Doe")).toBe(true);
  });

  it("rejects single-token and org-shaped strings", () => {
    expect(isPlausiblePersonName("Madonna")).toBe(false);
    expect(isPlausiblePersonName("Sequoia Capital")).toBe(false);
  });
});

describe("isCompanyNameAsPerson", () => {
  it("matches the bare company name and a corp suffix variant", () => {
    expect(isCompanyNameAsPerson("Arcade", "Arcade")).toBe(true);
    expect(isCompanyNameAsPerson("Giga Co", "Giga")).toBe(true);
    expect(isCompanyNameAsPerson("Charles Packer", "Arcade")).toBe(false);
  });
});
