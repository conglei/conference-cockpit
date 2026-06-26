"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "./Avatar";
import { replaceQuery } from "./url-state";

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
 * Browse everyone in the graph — search by name/role/company, filter by vertical
 * or "speaking only", sort. The ranked, taste-driven view is the home
 * `who-to-meet` page; this is the neutral A–Z explorer. Filter + sort run in
 * memory and mirror to the URL.
 */
export default function PeopleDirectory({
  people,
  initialQuery,
  initialVertical,
  initialSpeaking,
  initialSort,
}: {
  people: PersonCardData[];
  initialQuery?: string;
  initialVertical?: string;
  initialSpeaking?: boolean;
  initialSort?: string;
}) {
  const verticals = useMemo(
    () => [...new Set(people.flatMap((p) => p.verticals))].sort(),
    [people],
  );

  const [q, setQ] = useState(initialQuery ?? "");
  const [vertical, setVertical] = useState(initialVertical ?? "all");
  const [speaking, setSpeaking] = useState(Boolean(initialSpeaking));
  const [sort, setSort] = useState<SortKey>(
    (SORTS.some((s) => s.key === initialSort) ? initialSort : "name") as SortKey,
  );

  useEffect(() => {
    replaceQuery({
      q: q || undefined,
      vertical: vertical === "all" ? undefined : vertical,
      speaking: speaking ? "1" : undefined,
      sort: sort === "name" ? undefined : sort,
    });
  }, [q, vertical, speaking, sort]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = people.filter((p) => {
      if (speaking && !p.speaking) return false;
      if (vertical !== "all" && !p.verticals.includes(vertical)) return false;
      if (needle) {
        const hay = `${p.name} ${p.headline ?? ""} ${p.companyName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case "company":
          return (a.companyName ?? "~").localeCompare(b.companyName ?? "~") || a.name.localeCompare(b.name);
        case "speaking":
          return Number(b.speaking) - Number(a.speaking) || a.name.localeCompare(b.name);
        case "name":
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [people, q, vertical, speaking, sort]);

  return (
    <>
      <div className="dir-controls">
        <input
          type="search"
          className="dir-search"
          placeholder="Search people, roles, companies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="search people"
        />
        <select
          className="dir-select"
          value={vertical}
          onChange={(e) => setVertical(e.target.value)}
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
            onChange={(e) => setSpeaking(e.target.checked)}
          />
          Speaking only
        </label>
      </div>

      <div className="dir-subbar">
        <span className="dir-count">
          {rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
        <span className="dir-sort">
          sort:
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="dir-sort-btn"
              data-active={sort === s.key}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No people match these filters.</p>
      ) : (
        <div className="dir-grid">
          {rows.map((p) => (
            <PersonCard key={p.slug} p={p} />
          ))}
        </div>
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
