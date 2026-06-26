"use client";

import { useEffect, useMemo, useState } from "react";
import { replaceQuery } from "./url-state";

/** A company as the directory renders it — firmographics, not score axes. */
export type CompanyCardData = {
  slug: string;
  name: string;
  domain: string | null;
  description: string | null;
  industry: string | null;
  verticals: string[];
  stage: string | null;
  location: string | null;
  headcount: string | null;
  latestRound: string | null;
  fundingTotal: string | null;
  lastFundingDate: string | null;
  roleCount: number;
  score: number | null;
};

type SortKey = "roles" | "funded" | "name" | "fit";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "roles", label: "Hiring" },
  { key: "funded", label: "Recently funded" },
  { key: "name", label: "Name" },
  { key: "fit", label: "Fit" },
];

/**
 * Browse the companies graph by firmographics — search, vertical, "hiring only",
 * and a sort that matches how a job-seeker explores (who's hiring / who raised),
 * not a taste-score spreadsheet. Fit is a *bonus* axis, shown only where a taste
 * score exists. Filter + sort run in memory and mirror to the URL.
 */
export default function CompaniesDirectory({
  companies,
  initialQuery,
  initialVertical,
  initialSort,
  initialHiring,
}: {
  companies: CompanyCardData[];
  initialQuery?: string;
  initialVertical?: string;
  initialSort?: string;
  initialHiring?: boolean;
}) {
  const anyScored = useMemo(() => companies.some((c) => c.score != null), [companies]);
  const verticals = useMemo(
    () => [...new Set(companies.flatMap((c) => c.verticals))].sort(),
    [companies],
  );

  const [q, setQ] = useState(initialQuery ?? "");
  const [vertical, setVertical] = useState(initialVertical ?? "all");
  const [hiring, setHiring] = useState(Boolean(initialHiring));
  const [sort, setSort] = useState<SortKey>(
    (SORTS.some((s) => s.key === initialSort) ? initialSort : anyScored ? "fit" : "roles") as SortKey,
  );

  useEffect(() => {
    replaceQuery({
      q: q || undefined,
      vertical: vertical === "all" ? undefined : vertical,
      sort: sort === (anyScored ? "fit" : "roles") ? undefined : sort,
      hiring: hiring ? "1" : undefined,
    });
  }, [q, vertical, hiring, sort, anyScored]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = companies.filter((c) => {
      if (hiring && c.roleCount === 0) return false;
      if (vertical !== "all" && !c.verticals.includes(vertical)) return false;
      if (needle) {
        // Match identity + category, NOT the prose description (which makes
        // "google" match every "ex-Google founders" blurb).
        const hay = `${c.name} ${c.domain ?? ""} ${c.industry ?? ""} ${c.verticals.join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "funded":
          return (b.lastFundingDate ?? "").localeCompare(a.lastFundingDate ?? "");
        case "fit":
          return (b.score ?? -1) - (a.score ?? -1) || b.roleCount - a.roleCount;
        case "roles":
        default:
          return b.roleCount - a.roleCount || a.name.localeCompare(b.name);
      }
    });
  }, [companies, q, vertical, hiring, sort]);

  const sorts = anyScored ? SORTS : SORTS.filter((s) => s.key !== "fit");

  return (
    <>
      <div className="dir-controls">
        <input
          type="search"
          className="dir-search"
          placeholder="Search companies, what they build…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="search companies"
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
            checked={hiring}
            onChange={(e) => setHiring(e.target.checked)}
          />
          Hiring only
        </label>
      </div>

      <div className="dir-subbar">
        <span className="dir-count">
          {rows.length} compan{rows.length === 1 ? "y" : "ies"}
        </span>
        <span className="dir-sort">
          sort:
          {sorts.map((s) => (
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
        <p className="empty">No companies match these filters.</p>
      ) : (
        <div className="dir-grid">
          {rows.map((c) => (
            <CompanyCard key={c.slug} c={c} />
          ))}
        </div>
      )}
    </>
  );
}

function CompanyCard({ c }: { c: CompanyCardData }) {
  const meta = [c.stage, c.location, c.headcount ? `${c.headcount} ppl` : null]
    .filter(Boolean)
    .join(" · ");
  const funding = [c.latestRound, c.fundingTotal ? `${c.fundingTotal} total` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <a className="dir-card" href={`/companies/${c.slug}`}>
      <div className="dir-card-head">
        <h3 className="dir-card-name">{c.name}</h3>
        {c.score != null ? (
          <span className="dir-fit" title="Career Mover fit score">
            {c.score}
          </span>
        ) : null}
      </div>
      {c.domain ? <span className="dir-domain">{c.domain}</span> : null}
      {c.description ? <p className="dir-desc">{c.description}</p> : null}

      {c.verticals.length ? (
        <div className="dir-tags">
          {c.verticals.slice(0, 3).map((v) => (
            <span key={v} className="dir-tag">
              {v}
            </span>
          ))}
        </div>
      ) : null}

      <div className="dir-card-foot">
        {meta ? <span className="dir-meta">{meta}</span> : null}
        {funding ? <span className="dir-funding">{funding}</span> : null}
        {c.roleCount > 0 ? (
          <span className="dir-hiring">
            {c.roleCount} open role{c.roleCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </a>
  );
}
