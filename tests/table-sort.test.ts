import { describe, expect, it } from "vitest";
import {
  filterByStatus,
  sortApplications,
  sortRoles,
  type SortableApplication,
  type SortableRole,
} from "../src/ui/table-sort";

const roles: SortableRole[] = [
  { id: 1, title: "Founding Engineer", companyName: "Acme", postedDate: "2026-01-10" },
  { id: 2, title: "AI Researcher", companyName: "Zeta", postedDate: "2026-03-01" },
  { id: 3, title: "MTS", companyName: null, postedDate: null },
  { id: 4, title: "Backend Engineer", companyName: "Acme", postedDate: "2026-02-15" },
];

const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

describe("sortRoles", () => {
  it("sorts by title asc and desc", () => {
    expect(ids(sortRoles(roles, "title", "asc"))).toEqual([2, 4, 1, 3]);
    expect(ids(sortRoles(roles, "title", "desc"))).toEqual([3, 1, 4, 2]);
  });

  it("sorts by company with nulls last in both directions", () => {
    // Acme (1,4) before Zeta (2), null (3) last. Ties broken by title.
    expect(ids(sortRoles(roles, "company", "asc"))).toEqual([4, 1, 2, 3]);
    const desc = sortRoles(roles, "company", "desc");
    expect(desc[0].companyName).toBe("Zeta");
    expect(desc[desc.length - 1].companyName).toBeNull();
  });

  it("sorts by posted date with nulls last", () => {
    expect(ids(sortRoles(roles, "posted", "asc"))).toEqual([1, 4, 2, 3]);
    const desc = sortRoles(roles, "posted", "desc");
    expect(ids(desc)).toEqual([2, 4, 1, 3]);
    expect(desc[desc.length - 1].postedDate).toBeNull();
  });

  it("does not mutate the input array", () => {
    const before = ids(roles);
    sortRoles(roles, "title", "asc");
    expect(ids(roles)).toEqual(before);
  });
});

const apps: SortableApplication[] = [
  { id: 1, companyName: "Acme", status: "applied", appliedAt: 200 },
  { id: 2, companyName: "Zeta", status: "interviewing", appliedAt: 100 },
  { id: 3, companyName: "Acme", status: "offer", appliedAt: null },
  { id: 4, companyName: "Beta", status: "applied", appliedAt: 150 },
];

describe("sortApplications", () => {
  it("sorts by company asc and desc", () => {
    // Acme (1,3) Beta (4) Zeta (2); ties broken by id.
    expect(ids(sortApplications(apps, "company", "asc"))).toEqual([1, 3, 4, 2]);
    expect(ids(sortApplications(apps, "company", "desc"))).toEqual([2, 4, 1, 3]);
  });

  it("sorts by stage (status) asc", () => {
    // applied (1,4), interviewing (2), offer (3); ties by company then id.
    expect(ids(sortApplications(apps, "stage", "asc"))).toEqual([1, 4, 2, 3]);
  });

  it("sorts by applied date with nulls last", () => {
    expect(ids(sortApplications(apps, "applied", "asc"))).toEqual([2, 4, 1, 3]);
    const desc = sortApplications(apps, "applied", "desc");
    expect(ids(desc)).toEqual([1, 4, 2, 3]);
    expect(desc[desc.length - 1].appliedAt).toBeNull();
  });
});

describe("filterByStatus", () => {
  it("returns all rows for 'all' or undefined", () => {
    expect(filterByStatus(apps, "all")).toHaveLength(4);
    expect(filterByStatus(apps, undefined)).toHaveLength(4);
  });

  it("filters to a single status", () => {
    expect(ids(filterByStatus(apps, "applied"))).toEqual([1, 4]);
    expect(filterByStatus(apps, "offer")).toHaveLength(1);
  });

  it("returns an empty array for an unknown status", () => {
    expect(filterByStatus(apps, "nope")).toHaveLength(0);
  });

  it("returns a copy, not the original reference", () => {
    expect(filterByStatus(apps, "all")).not.toBe(apps);
  });
});
