"use client";

import { useEffect, useMemo, useState } from "react";
import type { Company } from "@/db/schema";
import { COMPANY_STATUS } from "@/db/schema";
// Import from the leaf `sort` module, not the `@/scoring` barrel: the barrel
// pulls in `weights.ts` (node:fs), which webpack can't bundle into a client
// component. `sort.ts` is pure and DOM/node-free.
import {
  SCORE_AXES,
  scoreValue,
  sortByScore,
  type ScoreAxis,
} from "@/scoring/sort";
import { filterByStatus } from "@/ui/table-sort";
import { replaceQuery } from "./url-state";

function fmtScore(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

const AXIS_LABEL: Record<ScoreAxis, string> = {
  overall: "Overall",
  founder_quality: "Founder",
  investor_quality: "Investor",
  domain_fit: "Domain",
  stage_fit: "Stage",
  size_fit: "Size",
};

/**
 * Client-side Companies table. Filtering by status and sorting by score axis
 * happen entirely in memory — instant, no navigation. The active state is
 * mirrored into the URL via a shallow `history.replaceState` so the view stays
 * deep-linkable. Initial state comes from the server (seeded from searchParams).
 */
export default function CompaniesTable({
  companies,
  initialStatus,
  initialSort,
  initialDir,
}: {
  companies: Company[];
  initialStatus?: string;
  initialSort: ScoreAxis;
  initialDir: "asc" | "desc";
}) {
  const [status, setStatus] = useState<string>(initialStatus ?? "all");
  const [sort, setSort] = useState<ScoreAxis>(initialSort);
  const [dir, setDir] = useState<"asc" | "desc">(initialDir);

  // Keep the URL in sync with the active view (shallow — no server round-trip).
  useEffect(() => {
    replaceQuery({
      status: status === "all" ? undefined : status,
      sort,
      dir,
    });
  }, [status, sort, dir]);

  const rows = useMemo(
    () => sortByScore(filterByStatus(companies, status), sort, dir),
    [companies, status, sort, dir],
  );

  // Clicking the active axis flips direction; a new axis defaults to desc.
  const onSort = (axis: ScoreAxis) => {
    if (axis === sort) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(axis);
      setDir("desc");
    }
  };

  return (
    <>
      <nav className="filters">
        <button
          type="button"
          className="filter"
          data-active={status === "all"}
          onClick={() => setStatus("all")}
        >
          all
        </button>
        {COMPANY_STATUS.map((s) => (
          <button
            key={s}
            type="button"
            className="filter"
            data-active={status === s}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </nav>

      <nav className="filters" aria-label="sort by score axis">
        <span className="muted" style={{ alignSelf: "center", marginRight: 4 }}>
          sort:
        </span>
        {SCORE_AXES.map((axis) => {
          const isActive = axis === sort;
          return (
            <button
              key={axis}
              type="button"
              className="filter"
              data-active={isActive}
              onClick={() => onSort(axis)}
            >
              {AXIS_LABEL[axis]}
              {isActive ? (dir === "desc" ? " ↓" : " ↑") : ""}
            </button>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p className="empty">
          No companies{status !== "all" ? ` with status “${status}”` : ""}. Run{" "}
          <code>pnpm db:seed</code> to load fixtures.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Founder</th>
              <th>Investor</th>
              <th>Domain</th>
              <th>Stage fit</th>
              <th>Size</th>
              <th>Overall</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`/companies/${c.slug}`}>
                    <strong>{c.name}</strong>
                  </a>
                  {c.description ? (
                    <div className="muted">{c.description}</div>
                  ) : null}
                </td>
                <td>{c.stage ?? "—"}</td>
                <td>
                  <span className="status">{c.status}</span>
                </td>
                <td data-axis={sort === "founder_quality" ? "active" : undefined}>
                  {fmtScore(scoreValue(c, "founder_quality"))}
                </td>
                <td data-axis={sort === "investor_quality" ? "active" : undefined}>
                  {fmtScore(scoreValue(c, "investor_quality"))}
                </td>
                <td data-axis={sort === "domain_fit" ? "active" : undefined}>
                  {fmtScore(scoreValue(c, "domain_fit"))}
                </td>
                <td data-axis={sort === "stage_fit" ? "active" : undefined}>
                  {fmtScore(scoreValue(c, "stage_fit"))}
                </td>
                <td data-axis={sort === "size_fit" ? "active" : undefined}>
                  {fmtScore(scoreValue(c, "size_fit"))}
                </td>
                <td data-axis={sort === "overall" ? "active" : undefined}>
                  <strong>{fmtScore(scoreValue(c, "overall"))}</strong>
                </td>
                <td className="muted">{c.scoreRationale ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
