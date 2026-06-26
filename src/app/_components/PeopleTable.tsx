"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";

/** A person as the directory renders it — a browsable, taste-neutral card. */
export type PersonCardData = {
  slug: string;
  name: string;
  headline: string | null;
  companyName: string | null;
  verticals: string[];
  speaking: boolean;
  photoUrl: string | null;
  location: string | null;
};

type SortKey = "name" | "company" | "speaking";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "speaking", label: "Speaking" },
];

/**
 * Browse everyone in the graph. Search, vertical filter, "speaking only", sort,
 * and pagination all happen on the SERVER (the page queries one page at a time) —
 * this client component reflects current state and pushes URL changes, so the
 * full people set is never shipped or filtered in the browser. Search debounces.
 */
export default function PeopleDirectory({
  people,
  total,
  page,
  pageSize,
  q,
  vertical,
  verticals,
  speaking,
  sort,
}: {
  people: PersonCardData[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  vertical: string;
  verticals: string[];
  speaking: boolean;
  sort: SortKey;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  /** Build /people?… from current state plus overrides (defaults omitted). */
  const urlFor = (over: Partial<Record<string, string | undefined>>) => {
    const m = { q, vertical, speaking: speaking ? "1" : undefined, sort, page: String(page), ...over };
    const p = new URLSearchParams();
    if (m.q) p.set("q", m.q);
    if (m.vertical && m.vertical !== "all") p.set("vertical", m.vertical);
    if (m.speaking) p.set("speaking", "1");
    if (m.sort && m.sort !== "name") p.set("sort", m.sort);
    if (m.page && m.page !== "1") p.set("page", m.page);
    const qs = p.toString();
    return qs ? `/people?${qs}` : "/people";
  };
  // Filter/sort/search changes reset to page 1; pagination sets page explicitly.
  const go = (over: Partial<Record<string, string | undefined>>) =>
    router.push(urlFor({ page: "1", ...over }));

  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => go({ q: search || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <>
      <div className="dir-controls">
        <input
          type="search"
          className="dir-search"
          placeholder="Search people, roles, companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="search people"
        />
        <select
          className="dir-select"
          value={vertical}
          onChange={(e) => go({ vertical: e.target.value === "all" ? undefined : e.target.value })}
          aria-label="filter by vertical"
        >
          <option value="all">All verticals</option>
          {verticals.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <label className="dir-toggle">
          <input
            type="checkbox"
            checked={speaking}
            onChange={(e) => go({ speaking: e.target.checked ? "1" : undefined })}
          />
          Speaking only
        </label>
      </div>

      <div className="dir-subbar">
        <span className="dir-count">
          {total.toLocaleString()} {total === 1 ? "person" : "people"}
        </span>
        <span className="dir-sort">
          sort:
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="dir-sort-btn"
              data-active={sort === s.key}
              onClick={() => go({ sort: s.key === "name" ? undefined : s.key })}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      {people.length === 0 ? (
        <p className="empty">No people match these filters.</p>
      ) : (
        <>
          <div className="dir-grid">
            {people.map((p) => (
              <PersonCard key={p.slug} p={p} />
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

function PersonCard({ p }: { p: PersonCardData }) {
  return (
    <a className="ppl-card" href={`/people/${p.slug}`}>
      <Avatar name={p.name} src={p.photoUrl} size={44} />
      <div className="ppl-card-body">
        <div className="ppl-card-head">
          <span className="ppl-card-name">{p.name}</span>
          {p.speaking ? <span className="ppl-speaking">Speaking</span> : null}
        </div>
        {p.headline ? <span className="ppl-card-headline">{p.headline}</span> : null}
        <div className="ppl-card-foot">
          {p.companyName ? <span className="ppl-card-co">{p.companyName}</span> : null}
          {p.location ? <span className="ppl-card-loc">{p.location}</span> : null}
        </div>
        {p.verticals.length ? (
          <div className="dir-tags">
            {p.verticals.slice(0, 2).map((v) => (
              <span key={v} className="dir-tag">
                {v}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </a>
  );
}
