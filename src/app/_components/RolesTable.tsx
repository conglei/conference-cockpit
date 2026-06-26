"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_STATUS } from "@/db/schema";
import { type RoleSortKey, type SortDir } from "@/ui/table-sort";

/** A plain-serializable role row enriched with its company's fit + freshness. */
export type RoleRow = {
  id: number;
  title: string;
  url: string | null;
  location: string | null;
  workType: string | null;
  salary: string | null;
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
 * Roles explorer. Filtering, search, sort, and pagination all happen on the
 * SERVER (the page queries one page at a time) — this client component just
 * reflects the current state and pushes URL changes, so a ~4.6k-role dataset is
 * never shipped or sorted in the browser. Search is debounced before navigating.
 */
export default function RolesExplorer({
  rows,
  total,
  page,
  pageSize,
  q,
  status,
  workType,
  workTypes,
  sort,
  dir,
  anyScored,
}: {
  rows: RoleRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  workType: string;
  workTypes: string[];
  sort: RoleSortKey;
  dir: SortDir;
  anyScored: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  /** Build /roles?… from the current state plus overrides (defaults omitted). */
  const urlFor = (over: Partial<Record<string, string | undefined>>) => {
    const m = { q, status, workType, sort, dir, page: String(page), ...over };
    const p = new URLSearchParams();
    if (m.q) p.set("q", m.q);
    if (m.status && m.status !== "all") p.set("status", m.status);
    if (m.workType && m.workType !== "all") p.set("workType", m.workType);
    if (m.sort && m.sort !== "posted") p.set("sort", m.sort);
    if (m.dir && m.dir !== "desc") p.set("dir", m.dir);
    if (m.page && m.page !== "1") p.set("page", m.page);
    const qs = p.toString();
    return qs ? `/roles?${qs}` : "/roles";
  };
  // A filter/sort/search change resets to page 1; pagination sets page explicitly.
  const go = (over: Partial<Record<string, string | undefined>>) =>
    router.push(urlFor({ page: "1", ...over }));

  // Keep the box in sync if the URL's q changes underneath us (back/forward).
  useEffect(() => setSearch(q), [q]);

  // Debounce typing, then navigate (server does the search).
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => go({ q: search || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onSort = (key: RoleSortKey) => {
    const keyParam = key === "posted" ? undefined : key;
    if (key === sort) go({ sort: keyParam, dir: dir === "asc" ? "desc" : "asc" });
    else go({ sort: keyParam, dir: key === "title" ? "asc" : "desc" });
  };

  const sortKeys: RoleSortKey[] = anyScored ? ["fit", "posted", "title"] : ["posted", "title"];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <>
      <div className="dir-controls">
        <input
          type="search"
          className="dir-search"
          placeholder="Search roles, companies, locations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="search roles"
        />
        <select
          className="dir-select"
          value={workType}
          onChange={(e) => go({ workType: e.target.value === "all" ? undefined : e.target.value })}
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
          onClick={() => go({ status: undefined })}
        >
          all
        </button>
        {ROLE_STATUS.map((s) => (
          <button
            key={s}
            type="button"
            className="filter"
            data-active={status === s}
            onClick={() => go({ status: s })}
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
          No roles{status !== "all" ? ` with status “${status}”` : ""}
          {q ? ` matching “${q}”` : ""}.
        </p>
      ) : (
        <>
          <div className="role-cards">
            {rows.map((r) => (
              <RoleCard key={r.id} r={r} />
            ))}
          </div>

          <nav className="pager" aria-label="pagination">
            <button
              type="button"
              className="filter"
              disabled={page <= 1}
              onClick={() => router.push(urlFor({ page: String(page - 1) }))}
            >
              ← Prev
            </button>
            <span className="muted">
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} · page {page}/{totalPages}
            </span>
            <button
              type="button"
              className="filter"
              disabled={page >= totalPages}
              onClick={() => router.push(urlFor({ page: String(page + 1) }))}
            >
              Next →
            </button>
          </nav>
        </>
      )}
    </>
  );
}

function RoleCard({ r }: { r: RoleRow }) {
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
    </article>
  );
}
