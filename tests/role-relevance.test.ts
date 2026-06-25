import { describe, it, expect } from "vitest";
import {
  isEngineeringRole,
  isExplicitlyJunior,
  isRelevantRole,
} from "../src/roles/role-relevance";

describe("isEngineeringRole", () => {
  it("keeps engineering IC + eng leadership titles", () => {
    const keep = [
      "Software Engineer",
      "Founding Engineer",
      "Member of Technical Staff",
      "ML Research Scientist",
      "Staff Frontend Infrastructure Engineer",
      "Head of Engineering",
      "Product Engineer",
      "Backend Developer",
    ];
    for (const title of keep) {
      expect(isEngineeringRole(title), title).toBe(true);
    }
  });

  it("drops titles with no engineering token", () => {
    const drop = [
      "Designer",
      "Enterprise Account Executive",
      "Growth Marketing Lead",
      "Product Manager",
      "Program Manager",
      "Senior Accountant",
      "HR Business Partner",
      "Senior Technical Recruiter",
      "Associate General Counsel",
      "Sales",
    ];
    for (const title of drop) {
      expect(isEngineeringRole(title), title).toBe(false);
    }
  });
});

describe("isExplicitlyJunior", () => {
  it("is true for explicit junior markers", () => {
    const junior = [
      "Software Engineer Intern",
      "New Grad Software Engineer",
      "Junior Developer",
      "Engineering Co-op",
    ];
    for (const title of junior) {
      expect(isExplicitlyJunior(title), title).toBe(true);
    }
  });

  it("is false for a bare or merely-senior title (seniority absence is not juniority)", () => {
    const notJunior = ["Software Engineer", "Senior Software Engineer", "Staff Engineer"];
    for (const title of notJunior) {
      expect(isExplicitlyJunior(title), title).toBe(false);
    }
  });
});

describe("isRelevantRole", () => {
  it("keeps engineering, non-junior roles — no senior word required", () => {
    expect(isRelevantRole("Software Engineer")).toBe(true);
    expect(isRelevantRole("Staff ML Engineer")).toBe(true);
  });

  it("drops junior engineering and non-engineering roles", () => {
    expect(isRelevantRole("Software Engineering Intern")).toBe(false);
    expect(isRelevantRole("Sales")).toBe(false);
  });
});
