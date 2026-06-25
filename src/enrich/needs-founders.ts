import type { Company, Person } from "../db/schema";

/**
 * Pure selector for the **browser rung** of the recovery ladder (ADR-0003 §2,
 * rung 4). A company is a candidate for the human-in-the-loop Claude-in-Chrome
 * pass when it is already `enriched` (the automatic ladder ran) yet still has
 * **zero founder people rows** — i.e. crawl → Apollo/HarvestAPI → web-search all
 * came up empty on founders.
 *
 * Kept DB-free so it can be unit-tested in isolation: pass the companies and a
 * map of companyId → that company's people rows; get back the subset needing a
 * browser pass.
 *
 * @param companies      all companies to consider (typically `repo.list()`).
 * @param peopleByCompany map from companyId to the people linked to it.
 */
export function needsFounders(
  companies: Company[],
  peopleByCompany: Map<number, Person[]>,
): Company[] {
  return companies.filter((c) => {
    if (c.status !== "enriched") return false;
    const people = peopleByCompany.get(c.id) ?? [];
    const hasFounder = people.some((p) => p.relationship === "founder");
    return !hasFounder;
  });
}
