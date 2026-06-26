import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { asList } from "@/db/columns";
import { createCompanyRepo, createRoleRepo } from "@/db/repository";
import { createPersonRepo } from "@/db/people-repository";
import { createTalkRepo } from "@/db/talk-repository";
import {
  careerMoverLens,
  loadGraph,
  loadGoalProfile,
  graphHasScores,
} from "@/plan";
import {
  formatChip,
  isThin,
  companyFundingProvenance,
  companyIdentityProvenance,
  type Provenance,
} from "@/provenance";
import { readDeepDive } from "@/enrich/read";
import type { Person } from "@/db/schema";
import CopyButton from "../../_components/CopyButton";
import Avatar from "../../_components/Avatar";

// The DB + markdown files are read at request time, not build time.
export const dynamic = "force-dynamic";

const SCORE_AXES = [
  { key: "scoreFounderQuality", label: "Founder" },
  { key: "scoreInvestorQuality", label: "Investor" },
  { key: "scoreDomainFit", label: "Domain" },
  { key: "scoreStageFit", label: "Stage" },
  { key: "scoreSizeFit", label: "Size" },
] as const;

export default async function CompanyBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const company = await createCompanyRepo(db).getBySlug(slug);
  if (!company) notFound();

  const now = new Date();
  const graph = await loadGraph(db);
  const ctx = {
    profile: loadGoalProfile(),
    graph,
    now,
    neutralMode: !graphHasScores(graph),
  };
  // The SAME sourced brief the trailer card renders — assembled by the lens.
  const score = careerMoverLens.scoreCompany(company, ctx);
  const brief = careerMoverLens.buildPlanned(company, score, 1, ctx);

  // Supplement the brief with the full graph neighborhood for exploration.
  const people = await createPersonRepo(db).list({ companyId: company.id });
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const roles = await createRoleRepo(db).list({ companyId: company.id });
  const talks = await createTalkRepo(db).byCompany(company.id);
  const markdown = readDeepDive(company.deepDivePath);

  const fundingProv = companyFundingProvenance(company);
  const identityProv = companyIdentityProvenance(company);

  // Firmographic spec strip — only the facts we actually have.
  const specs: { label: string; value: string }[] = [];
  if (company.stage) specs.push({ label: "Stage", value: company.stage });
  if (company.industry || company.category)
    specs.push({ label: "Category", value: company.industry ?? company.category! });
  if (company.location) specs.push({ label: "Location", value: company.location });
  if (company.foundedYear)
    specs.push({ label: "Founded", value: String(company.foundedYear) });
  if (company.headcount || company.sizeBand)
    specs.push({ label: "Size", value: String(company.headcount ?? company.sizeBand) });
  const verticals = asList(company.verticals);
  const keywords = asList(company.keywords);

  const fundingFacts: { label: string; value: string }[] = [];
  if (company.latestRound)
    fundingFacts.push({ label: "Latest round", value: String(company.latestRound) });
  if (company.latestAmount)
    fundingFacts.push({ label: "Amount", value: String(company.latestAmount) });
  if (company.fundingTotal)
    fundingFacts.push({ label: "Total raised", value: String(company.fundingTotal) });
  if (company.leadInvestor)
    fundingFacts.push({ label: "Lead investor", value: String(company.leadInvestor) });
  if (company.lastFundingDate)
    fundingFacts.push({ label: "Last funding", value: String(company.lastFundingDate) });

  return (
    <main className="brief">
      <nav className="brief-back">
        <a href="/companies">← Companies</a>
        <span className="brief-back-sep">·</span>
        <a href="/">The plan</a>
      </nav>

      {/* ---- Verdict header ---- */}
      <header className="brief-head">
        <div className="brief-head-main">
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
            <Chip prov={identityProv} now={now} />
          </div>
          {company.description ? (
            <p className="brief-tagline">{company.description}</p>
          ) : null}
          <p className="brief-why">{brief.whyLine}</p>
        </div>
        <div
          className="score brief-score"
          title="Career Mover fit score"
          aria-label={`Fit score ${Math.round(brief.score * 100)} of 100`}
        >
          {Math.round(brief.score * 100)}
        </div>
      </header>

      {/* ---- Spec strip ---- */}
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

      {(verticals.length || keywords.length) > 0 ? (
        <div className="brief-tags">
          {verticals.map((v) => (
            <span key={`v-${v}`} className="tag tag-vertical">
              {v}
            </span>
          ))}
          {keywords.slice(0, 8).map((k) => (
            <span key={`k-${k}`} className="tag">
              {k}
            </span>
          ))}
        </div>
      ) : null}

      {/* ---- Score breakdown (only when taste axes exist; hidden on a clean DB) ---- */}
      {SCORE_AXES.some((a) => typeof company[a.key as keyof typeof company] === "number") ? (
      <section className="brief-section">
        <span className="section-label">Why this score</span>
        <div className="score-axes">
          {SCORE_AXES.map((a) => {
            const raw = company[a.key as keyof typeof company];
            const val = typeof raw === "number" ? raw : null;
            return (
              <div className="score-axis" key={a.key}>
                <span className="axis-label">{a.label}</span>
                <span className="axis-bar" aria-hidden="true">
                  <span
                    className="axis-fill"
                    style={{ width: `${Math.round((val ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="axis-val num">
                  {val === null ? "—" : val.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
        {company.scoreRationale ? (
          <p className="brief-rationale">{company.scoreRationale}</p>
        ) : null}
      </section>
      ) : null}

      {/* ---- Why it fits (sourced claims) ---- */}
      {brief.claims.length ? (
        <section className="brief-section">
          <span className="section-label">Why it fits</span>
          <ul className="claims">
            {brief.claims.map((c, i) => (
              <li key={i}>
                <span className="claim-label">{c.label}</span>
                <span className="claim-text">{c.text}</span>
                <Chip prov={c.provenance} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Funding ---- */}
      {fundingFacts.length ? (
        <section className="brief-section">
          <span className="section-label">
            Funding <Chip prov={fundingProv} now={now} />
          </span>
          <dl className="brief-specs">
            {fundingFacts.map((f) => (
              <div key={f.label} className="brief-spec">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* ---- Who to meet ---- */}
      {people.length ? (
        <section className="brief-section">
          <span className="section-label">Who to meet ({people.length})</span>
          <div className="people-cards">
            {people.map((p) => (
              <PersonMini
                key={p.id}
                p={p}
                speaking={brief.whoToMeet.find((w) => w.personId === p.id)?.speaking}
                slot={slotFor(brief, p.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Open roles ---- */}
      {roles.length ? (
        <section className="brief-section">
          <span className="section-label">Open roles ({roles.length})</span>
          <ul className="role-list">
            {roles.map((r) => (
              <li key={r.id} className="role-item">
                <a
                  className="role-item-title"
                  href={r.url ?? "#"}
                  target={r.url ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  {r.title}
                </a>
                <span className="role-item-meta">
                  {[r.location, r.workType].filter(Boolean).join(" · ")}
                </span>
                {r.postedDate ? (
                  <span className="role-item-date num">{r.postedDate}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Talks ---- */}
      {talks.length ? (
        <section className="brief-section">
          <span className="section-label">Talks from this company</span>
          <ul className="talk-list">
            {talks.map((t) => (
              <li key={t.id} className="talk-item">
                <span className="talk-item-title">{t.title}</span>
                <span className="talk-item-slot num">
                  {[t.day, t.time, t.room, t.track].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Draft opener ---- */}
      <section className="brief-section opener">
        <span className="section-label">Draft opener</span>
        <p>{brief.opener}</p>
        <CopyButton text={brief.opener} />
      </section>

      {/* ---- Raw research (progressive disclosure) ---- */}
      {markdown ? (
        <details className="brief-raw">
          <summary>Research notes (raw) — every source, unedited</summary>
          <pre>{markdown}</pre>
        </details>
      ) : (
        <p className="empty">
          Not enriched yet. Run <code>pnpm enrich-company {slug}</code> to write
          its deep-dive.
        </p>
      )}
    </main>
  );
}

function slotFor(
  brief: { whoToMeet: { personId: number; talk?: { day?: string | null; time?: string | null; room?: string | null } }[] },
  personId: number,
): string | null {
  const w = brief.whoToMeet.find((x) => x.personId === personId);
  if (!w?.talk) return null;
  return [w.talk.day, w.talk.time, w.talk.room].filter(Boolean).join(" · ") || null;
}

function PersonMini({
  p,
  speaking,
  slot,
}: {
  p: Person;
  speaking?: boolean;
  slot: string | null;
}) {
  return (
    <a className="person-mini" href={`/people/${p.slug}`}>
      <Avatar name={p.name} src={p.photoUrl} size={40} />
      <span className="person-mini-body">
        <span className="person-mini-name">{p.name}</span>
        {p.title ? <span className="person-mini-title">{p.title}</span> : null}
        {speaking && slot ? (
          <span className="speaking">
            <MicIcon />
            {slot}
          </span>
        ) : p.connectionDegree === 1 ? (
          <span className="attending">1st-degree connection</span>
        ) : null}
      </span>
    </a>
  );
}

function Chip({ prov, now }: { prov: Provenance; now: Date }) {
  return (
    <span className="prov-chip" data-thin={isThin(prov, now)}>
      {formatChip(prov, now)}
    </span>
  );
}

/** Small mic glyph marking a speaker's talk slot (SVG, not emoji). */
function MicIcon() {
  return (
    <svg
      className="mic-icon"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </svg>
  );
}
