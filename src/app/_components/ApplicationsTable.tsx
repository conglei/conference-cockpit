"use client";

import { useEffect, useMemo, useState } from "react";
import { APPLICATION_STATUS } from "@/db/schema";
import {
  filterByStatus,
  sortApplications,
  type ApplicationSortKey,
  type SortDir,
} from "@/ui/table-sort";
import { replaceQuery } from "./url-state";

/** A plain-serializable application row, flattened from `listWithContext`. */
export type ApplicationRow = {
  id: number;
  companyName: string;
  roleTitle: string;
  status: string;
  contactName: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  appliedAt: number | null;
};

const SORT_LABEL: Record<ApplicationSortKey, string> = {
  company: "Company",
  stage: "Stage",
  applied: "Applied",
};

function fmtDate(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Client-side Applications table: status filter + sort by company / stage /
 * applied date, all in memory. Rows are flattened server-side from the repo's
 * `listWithContext` into plain serializable objects.
 */
export default function ApplicationsTable({
  applications,
  initialStatus,
  initialSort,
  initialDir,
}: {
  applications: ApplicationRow[];
  initialStatus?: string;
  initialSort: ApplicationSortKey;
  initialDir: SortDir;
}) {
  const [status, setStatus] = useState<string>(initialStatus ?? "all");
  const [sort, setSort] = useState<ApplicationSortKey>(initialSort);
  const [dir, setDir] = useState<SortDir>(initialDir);

  useEffect(() => {
    replaceQuery({
      status: status === "all" ? undefined : status,
      sort,
      dir,
    });
  }, [status, sort, dir]);

  const rows = useMemo(() => {
    const sorted = sortApplications(filterByStatus(applications, status), sort, dir);
    const byId = new Map(applications.map((r) => [r.id, r]));
    return sorted.map((r) => byId.get(r.id)!);
  }, [applications, status, sort, dir]);

  // Clicking the active column flips direction; a new column defaults to asc.
  const onSort = (key: ApplicationSortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir("asc");
    }
  };

  const header = (key: ApplicationSortKey) => {
    const isActive = key === sort;
    return (
      <th>
        <button
          type="button"
          className="th-sort"
          data-active={isActive}
          onClick={() => onSort(key)}
        >
          {SORT_LABEL[key]}
          {isActive ? (dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
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
        {APPLICATION_STATUS.map((s) => (
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

      {rows.length === 0 ? (
        <p className="empty">
          No applications{status !== "all" ? ` at stage “${status}”` : ""}.
          Advance one with{" "}
          <code>pnpm track advance &lt;id&gt; &lt;status&gt;</code>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              {header("company")}
              <th>Role</th>
              {header("stage")}
              <th>Contact</th>
              <th>Next action</th>
              {header("applied")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.companyName}</strong>
                </td>
                <td>{r.roleTitle}</td>
                <td>
                  <span className="status">{r.status}</span>
                </td>
                <td>{r.contactName ?? "—"}</td>
                <td>
                  {r.nextAction ?? "—"}
                  {r.nextActionDate ? (
                    <div className="muted">due {r.nextActionDate}</div>
                  ) : null}
                </td>
                <td>{fmtDate(r.appliedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
