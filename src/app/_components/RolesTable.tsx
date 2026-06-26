"use client";

import { useEffect, useMemo, useState } from "react";
import { ROLE_STATUS } from "@/db/schema";
import { filterByStatus, type RoleSortKey, type SortDir } from "@/ui/table-sort";
import { replaceQuery } from "./url-state";

/** A plain-serializable role row enriched with its company's fit + freshness. */
export type RoleRow = {
  id: number;
  title: string;
  url: string | null;
  location: string | null;
  workType: string | null;
  salary: string | null;
  description: string | null;
  postedDate: string | null;
  status: string;
  source: string | null;
  postedChip: string;
  postedThin: boolean;
  companyName: string | null;
  companySlug: string | null;
  companyScore: number | null;
};

const SORT_LABEL: Record<RoleSortKey, string> = {
  fit: "Company fit",
  posted: "Newest",
  title: "Title",
  company: "Company",
};

/**
 * Roles explorer: open roles as cards. Explore by what matters without a taste
 * profile — search, work type, and recency — with company fit as a *bonus* badge
 * and sort only where a score exists. Freshness is sourced on every posting; the
 * description opens on demand. Filter + sort run in memory and mirror to the URL.
 */
export default function RolesExplorer({
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
  const anyScored = useMemo(() => roles.some((r) => r.companyScore != null), [roles]);
  const workTypes = useMemo(
    () =>
      [...new Set(roles.map((r) => r.workType).filter((w): w is string => Boolean(w) && w !== "unknown"))].sort(),
    [roles],
  );
  const sortKeys: RoleSortKey[] = anyScored ? ["fit", "posted", "title"] : ["posted", "title"];

  const [status, setStatus] = useState<string>(initialStatus ?? "all");
  const [q, setQ] = useState<string>("");
  const [workType, setWorkType] = useState<string>("all");
  const [sort, setSort] = useState<RoleSortKey>(
    initialSort === "fit" && !anyScored ? "posted" : initialSort,
  );
  const [dir, setDir] = useState<SortDir>(initialDir);

  useEffect(() => {
    replaceQuery({
      status: status === "all" ? undefined : status,
      sort: sort === "posted" ? undefined : sort,
      dir,
    });
  }, [status, sort, dir]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = filterByStatus(roles, status).filter((r) => {
      if (workType !== "all" && r.workType !== workType) return false;
      if (needle) {
        const hay = `${r.title} ${r.companyName ?? ""} ${r.location ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort === "fit") cmp = (a.companyScore ?? -1) - (b.companyScore ?? -1);
      else if (sort === "posted")
        cmp = (a.postedDate ?? "").localeCompare(b.postedDate ?? "");
      else if (sort === "title") cmp = a.title.localeCompare(b.title);
      else cmp = (a.companyName ?? "").localeCompare(b.companyName ?? "");
      if (cmp === 0) cmp = (a.postedDate ?? "").localeCompare(b.postedDate ?? "");
      return cmp * sign;
    });
  }, [roles, status, q, workType, sort, dir]);

  // Clicking the active sort flips direction; a new key defaults to desc.
  const onSort = (key: RoleSortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "title" ? "asc" : "desc");
    }
  };

  return (
    <>
      <div className="dir-controls">
        <input
          type="search"
          className="dir-search"
          placeholder="Search roles, companies, locations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="search roles"
        />
        <select
          className="dir-select"
          value={workType}
          onChange={(e) => setWorkType(e.target.value)}
          aria-label="filter by work type"
        >
          <option value="all">Any location type</option>
          {workTypes.map((w) => (
            <option key={w} value={w}>
              {w[0].toUpperCase() + w.slice(1)}
            </option>
          ))}
        </select>
      </div>

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
        <span className="app-nav-divider" aria-hidden="true" />
        <span className="muted" style={{ alignSelf: "center", marginRight: 4 }}>
          sort:
        </span>
        {sortKeys.map((key) => {
          const active = key === sort;
          return (
            <button
              key={key}
              type="button"
              className="filter"
              data-active={active}
              onClick={() => onSort(key)}
            >
              {SORT_LABEL[key]}
              {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p className="empty">
          No roles{status !== "all" ? ` with status “${status}”` : ""}. Run{" "}
          <code>pnpm find-jobs &quot;founding engineer&quot;</code> to discover
          some.
        </p>
      ) : (
        <div className="role-cards">
          {rows.map((r) => (
            <RoleCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </>
  );
}

function RoleCard({ r }: { r: RoleRow }) {
  const [open, setOpen] = useState(false);
  const meta = [r.location, r.workType, r.salary].filter(Boolean).join(" · ");
  return (
    <article className="role-card">
      <div className="role-card-head">
        <h3 className="role-card-title">
          {r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title} ↗
            </a>
          ) : (
            r.title
          )}
        </h3>
        {r.companySlug ? (
          <a className="role-card-company" href={`/companies/${r.companySlug}`}>
            {r.companyScore != null ? (
              <span className="role-fit" title="Company fit score">
                {r.companyScore}
              </span>
            ) : null}
            {r.companyName}
          </a>
        ) : r.companyName ? (
          <span className="role-card-company">{r.companyName}</span>
        ) : null}
      </div>

      <div className="role-card-meta">
        {meta ? <span>{meta}</span> : null}
        <span className="prov-chip" data-thin={r.postedThin}>
          {r.postedChip}
        </span>
        <span className="status">{r.status}</span>
      </div>

      {r.description ? (
        <div className="role-card-desc">
          <p data-open={open}>{r.description}</p>
          <button
            type="button"
            className="role-card-more"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Show less" : "Show description"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
