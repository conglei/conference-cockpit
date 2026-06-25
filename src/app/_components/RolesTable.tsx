"use client";

import { useEffect, useMemo, useState } from "react";
import { ROLE_STATUS } from "@/db/schema";
import {
  filterByStatus,
  sortRoles,
  type RoleSortKey,
  type SortDir,
} from "@/ui/table-sort";
import { replaceQuery } from "./url-state";

/** A plain-serializable role row plus its resolved company (passed by the server). */
export type RoleRow = {
  id: number;
  title: string;
  url: string | null;
  location: string | null;
  postedDate: string | null;
  status: string;
  source: string | null;
  companyName: string | null;
  companyStatus: string | null;
};

const SORT_LABEL: Record<RoleSortKey, string> = {
  title: "Title",
  company: "Company",
  posted: "Posted",
};

/**
 * Client-side Roles table: status filter + sort by title / company / posted
 * date, all in memory. Company name is resolved server-side and threaded
 * through each row so the client can render and sort by it without a DB call.
 */
export default function RolesTable({
  roles,
  initialStatus,
  initialSort,
  initialDir,
}: {
  roles: RoleRow[];
  initialStatus?: string;
  initialSort: RoleSortKey;
  initialDir: SortDir;
}) {
  const [status, setStatus] = useState<string>(initialStatus ?? "all");
  const [sort, setSort] = useState<RoleSortKey>(initialSort);
  const [dir, setDir] = useState<SortDir>(initialDir);

  useEffect(() => {
    replaceQuery({
      status: status === "all" ? undefined : status,
      sort,
      dir,
    });
  }, [status, sort, dir]);

  const rows = useMemo(() => {
    const sorted = sortRoles(filterByStatus(roles, status), sort, dir);
    // `sortRoles` only carries the sort fields; re-attach full rows by id.
    const byId = new Map(roles.map((r) => [r.id, r]));
    return sorted.map((r) => byId.get(r.id)!);
  }, [roles, status, sort, dir]);

  // Clicking the active column flips direction; a new column defaults to asc.
  const onSort = (key: RoleSortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir("asc");
    }
  };

  const header = (key: RoleSortKey) => {
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
        {ROLE_STATUS.map((s) => (
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
          No roles{status !== "all" ? ` with status “${status}”` : ""}. Run{" "}
          <code>pnpm find-jobs &quot;founding engineer&quot;</code> to discover
          some.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              {header("title")}
              {header("company")}
              <th>Location</th>
              {header("posted")}
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      <strong>{r.title}</strong>
                    </a>
                  ) : (
                    <strong>{r.title}</strong>
                  )}
                </td>
                <td>
                  {r.companyName ? (
                    <a href={`/?status=${r.companyStatus}`}>{r.companyName}</a>
                  ) : (
                    "—"
                  )}
                  {r.companyName ? (
                    <div className="muted">{r.companyStatus}</div>
                  ) : null}
                </td>
                <td>{r.location ?? "—"}</td>
                <td>{r.postedDate ?? "—"}</td>
                <td>
                  <span className="status">{r.status}</span>
                </td>
                <td>{r.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
