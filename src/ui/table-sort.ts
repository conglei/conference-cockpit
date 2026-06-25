/**
 * Pure, DOM-free sort/filter helpers for the interactive list tables (issue 34).
 * The client table components import these so the same logic is unit-testable
 * (`tests/table-sort.test.ts`). Companies already has `sortByScore` in
 * `@/scoring`; this module covers roles + applications + a generic status filter.
 *
 * Rows here are the plain-serializable shapes the server pages pass into the
 * client components — not the raw Drizzle rows — so the helpers stay decoupled
 * from the data layer.
 */

export type SortDir = "asc" | "desc";

/** Generic status filter: `"all"` (or undefined) returns every row. */
export function filterByStatus<T extends { status: string }>(
  rows: readonly T[],
  status: string | undefined,
): T[] {
  if (!status || status === "all") return [...rows];
  return rows.filter((r) => r.status === status);
}

// --- roles ---

/** The keys a user can sort the roles view by. `fit` = company fit score. */
export const ROLE_SORT_KEYS = ["fit", "title", "company", "posted"] as const;
export type RoleSortKey = (typeof ROLE_SORT_KEYS)[number];

/** The minimal role shape the sorter needs (mirrors `RolesTable` rows). */
export type SortableRole = {
  id: number;
  title: string;
  companyName: string | null;
  postedDate: string | null;
};

/**
 * Sort a copy of `rows` by the given key. `posted` is an ISO date string that
 * sorts lexicographically; nulls (no company / no posted date) always sort last
 * regardless of direction. Stable on ties via title then id.
 */
export function sortRoles(
  rows: readonly SortableRole[],
  key: RoleSortKey,
  dir: SortDir = "asc",
): SortableRole[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = compareNullable(roleField(a, key), roleField(b, key), sign);
    return cmp !== 0 ? cmp : roleTieBreak(a, b);
  });
}

function roleField(r: SortableRole, key: RoleSortKey): string | null {
  switch (key) {
    case "title":
      return r.title;
    case "company":
      return r.companyName;
    case "posted":
      return r.postedDate;
    // `fit` ranks by company score (numeric) — handled by the client explorer,
    // not this string sorter; treat as no-op here.
    case "fit":
      return null;
  }
}

function roleTieBreak(a: SortableRole, b: SortableRole): number {
  return a.title.localeCompare(b.title) || a.id - b.id;
}

// --- applications ---

/** The columns a user can sort the applications table by. */
export const APPLICATION_SORT_KEYS = ["company", "stage", "applied"] as const;
export type ApplicationSortKey = (typeof APPLICATION_SORT_KEYS)[number];

/** The minimal application shape the sorter needs (mirrors `ApplicationsTable`). */
export type SortableApplication = {
  id: number;
  companyName: string;
  status: string;
  appliedAt: number | null;
};

/**
 * Sort a copy of `rows` by the given key. `applied` is an epoch-ms number;
 * unapplied rows (null) always sort last. Stable on ties via company then id.
 */
export function sortApplications(
  rows: readonly SortableApplication[],
  key: ApplicationSortKey,
  dir: SortDir = "asc",
): SortableApplication[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp =
      key === "applied"
        ? compareNullable(a.appliedAt, b.appliedAt, sign)
        : compareNullable(applicationField(a, key), applicationField(b, key), sign);
    return cmp !== 0 ? cmp : applicationTieBreak(a, b);
  });
}

function applicationField(
  r: SortableApplication,
  key: "company" | "stage",
): string {
  return key === "company" ? r.companyName : r.status;
}

function applicationTieBreak(
  a: SortableApplication,
  b: SortableApplication,
): number {
  return a.companyName.localeCompare(b.companyName) || a.id - b.id;
}

// --- shared comparison ---

/**
 * Compare two values that may be null. Nulls always sort last (after applying
 * `sign`, so they stay last in both directions). Strings compare via locale,
 * numbers numerically.
 */
function compareNullable(
  a: string | number | null,
  b: string | number | null,
  sign: number,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // a missing → after b
  if (b === null) return -1;
  if (typeof a === "string" && typeof b === "string") {
    return sign * a.localeCompare(b);
  }
  return sign * ((a as number) - (b as number));
}
