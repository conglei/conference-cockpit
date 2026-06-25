import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import { createTalkRepo } from "@/db/talk-repository";
import type { Company } from "@/db/schema";
import {
  companyFundingProvenance,
  companyIdentityProvenance,
  formatChip,
  roleProvenance,
} from "@/provenance";
import { SCORE_AXES, scoreValue, type ScoreAxis } from "@/scoring/sort";
import Avatar from "../../_components/Avatar";

// Read at request time so a re-enrich shows up on refresh.
export const dynamic = "force-dynamic";

const AXIS_LABEL: Record<ScoreAxis, string> = {
  overall: "Overall",
  founder_quality: "Founder",
  investor_quality: "Investor",
  domain_fit: "Domain",
  stage_fit: "Stage",
  size_fit: "Size",
};

function photoSrc(u: string | null): string | null {
  if (!u) return null;
  return u.startsWith("http") ? u : `https://ai.engineer${u}`;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function fundingLine(c: Company): string | null {
  const round = c.latestRound;
  const amt = c.latestAmount;
  const total = c.fundingTotal;
  const lead = [round, amt].filter(Boolean).join(" ");
  if (lead && total) return `${lead} · ${total} total`;
  return lead || total || null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const company = createCompanyRepo(getDb()).getBySlug(slug);
  if (!company) return { title: "Company not found · Conference Compass" };
  return {
    title: `${company.name}${company.domain ? ` (${company.domain})` : ""} · Conference Compass`,
  };
}

export default async function CompanyBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const db = getDb();
  const companyRepo = createCompanyRepo(db);
  const peopleRepo = createPersonRepo(db);
  const roleRepo = createRoleRepo(db);
  const talkRepo = createTalkRepo(db);

  const company = companyRepo.getBySlug(slug);
  if (!company) notFound();

  const now = new Date();
  const overall =
    company.scoreOverall != null ? Math.round(company.scoreOverall * 100) : null;
  const verticals = parseList(company.verticals);
  const keywords = parseList(company.keywords);

  // People at the company, founders + speakers first.
  const speakerIds = new Set(
    talkRepo.byCompany(company.id).map((t) => t.speakerId),
  );
  const people = peopleRepo
    .listByCompany(company.id)
    .sort((a, b) => rankPerson(b, speakerIds) - rankPerson(a, speakerIds));

  const roles = roleRepo
    .list({ companyId: company.id })
    .sort((a, b) => (a.status === "interesting" ? -1 : 0) - (b.status === "interesting" ? -1 : 0))
    .slice(0, 20);
  const totalRoles = roleRepo.list({ companyId: company.id }).length;

  const specs = buildSpecs(company);
  const idProv = formatChip(companyIdentityProvenance(company, now), now);
  const fundProv = formatChip(companyFundingProvenance(company, now), now);
  const funding = fundingLine(company);

  return (
    <main className="brief">
      <p className="brief-back">
        <a href="/">← Who to meet</a>
        <span className="brief-back-sep">/</span>
        <a href="/companies">Companies</a>
      </p>

      <header className="brief-head">
        <div>
          <h1>{company.name}</h1>
          <div className="brief-head-meta">
            {company.domain ? (
              <a
                className="brief-domain"
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer"
              >
                {company.domain} ↗
              </a>
            ) : null}
            <span className="status">{company.status}</span>
            <span className="prov-chip">{idProv}</span>
          </div>
          {company.description ? (
            <p className="brief-tagline">{company.description}</p>
          ) : null}
          {company.scoreRationale ? (
            <p className="brief-why">{company.scoreRationale}</p>
          ) : null}
        </div>
        {overall != null ? (
          <span className="score brief-score" title="overall fit score">
            {overall}
          </span>
        ) : null}
      </header>

      {specs.length ? (
        <dl className="brief-specs">
          {specs.map((s) => (
            <div key={s.label} className="brief-spec">
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {verticals.length || keywords.length ? (
        <div className="brief-tags">
          {verticals.map((v) => (
            <span key={v} className="tag tag-vertical">
              {v}
            </span>
          ))}
          {keywords.slice(0, 8).map((k) => (
            <span key={k} className="tag">
              {k}
            </span>
          ))}
        </div>
      ) : null}

      {company.scoreOverall != null ? (
        <section className="brief-section">
          <span className="section-label">Why this score</span>
          <div className="score-axes">
            {SCORE_AXES.filter((a) => a !== "overall").map((axis) => {
              const v = scoreValue(company, axis);
              if (v == null) return null;
              return (
                <div key={axis} className="score-axis">
                  <span className="axis-label">{AXIS_LABEL[axis]}</span>
                  <span className="axis-bar">
                    <span
                      className="axis-fill"
                      style={{ width: `${Math.round(clamp01(v) * 100)}%` }}
                    />
                  </span>
                  <span className="axis-val">{v.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
          {funding ? (
            <p className="brief-rationale">
              Funding: {funding}{" "}
              <span className="prov-chip">{fundProv}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {people.length ? (
        <section className="brief-section">
          <span className="section-label">
            Who to meet here ({people.length})
          </span>
          <div className="people-cards">
            {people.map((p) => (
              <a key={p.id} className="person-mini" href={`/people/${p.slug}`}>
                <Avatar name={p.name} src={photoSrc(p.photoUrl)} size={40} />
                <span className="person-mini-body">
                  <span className="person-mini-name">{p.name}</span>
                  {p.headline || p.title ? (
                    <span className="person-mini-title">
                      {p.headline ?? p.title}
                    </span>
                  ) : null}
                  {speakerIds.has(p.id) ? (
                    <span className="speaking">🎤 speaking</span>
                  ) : p.relationship === "founder" ? (
                    <span className="attending">founder</span>
                  ) : null}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {roles.length ? (
        <section className="brief-section">
          <span className="section-label">
            Open roles ({totalRoles}
            {totalRoles > roles.length ? ` · showing ${roles.length}` : ""})
          </span>
          <ul className="role-list">
            {roles.map((r) => (
              <li key={r.id} className="role-item">
                {r.url ? (
                  <a
                    className="role-item-title"
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {r.title} ↗
                  </a>
                ) : (
                  <span className="role-item-title">{r.title}</span>
                )}
                {r.location ? (
                  <span className="role-item-meta">{r.location}</span>
                ) : null}
                <span className="role-item-date">
                  {formatChip(roleProvenance(r, now), now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {company.enrichmentBlob ? (
        <details className="brief-raw">
          <summary>Raw enrichment</summary>
          <pre>{company.enrichmentBlob}</pre>
        </details>
      ) : null}
    </main>
  );
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function rankPerson(p: { id: number; relationship: string }, speakers: Set<number>): number {
  let r = 0;
  if (speakers.has(p.id)) r += 2;
  if (p.relationship === "founder") r += 1;
  return r;
}

function buildSpecs(c: Company): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (c.stage) out.push({ label: "Stage", value: c.stage });
  if (c.sizeBand || c.headcount)
    out.push({
      label: "Size",
      value: c.headcount ? `${c.headcount} ppl` : (c.sizeBand as string),
    });
  if (c.foundedYear) out.push({ label: "Founded", value: String(c.foundedYear) });
  if (c.location) out.push({ label: "Location", value: c.location });
  if (c.industry) out.push({ label: "Industry", value: c.industry });
  if (c.leadInvestor) out.push({ label: "Lead investor", value: c.leadInvestor });
  return out;
}
