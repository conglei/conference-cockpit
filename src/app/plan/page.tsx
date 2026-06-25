import { getDb } from "@/db/client";
import { createPersonRepo } from "@/db/people-repository";
import {
  buildPlan,
  loadGraph,
  loadGoalProfile,
  careerMoverLens,
  type PlannedCompany,
} from "@/plan";
import { formatChip, type Provenance } from "@/provenance";
import CopyButton from "../_components/CopyButton";

// Read the DB at request time, not build time.
export const dynamic = "force-dynamic";

const LIMIT = 8;

export default async function PlanPage() {
  const db = getDb();
  const now = new Date();
  const plan = buildPlan({
    lens: careerMoverLens,
    profile: loadGoalProfile(),
    graph: loadGraph(db),
    limit: LIMIT,
    now,
  });
  // The raw alternative: the flat directory the plan replaces.
  const directory = createPersonRepo(db).list();

  return (
    <main className="plan-main">
      <header className="plan-hero">
        <h1>Conference Compass</h1>
        <p className="subtitle">
          AI Engineer World&apos;s Fair 2026 · <strong>Career Mover</strong> lens
        </p>
        <p className="plan-claim">
          <span className="big">{directory.length}</span> names in the directory →{" "}
          <span className="big accent">{plan.companies.length}</span> ranked targets,
          each sourced — in the time it takes to ask.
        </p>
      </header>

      <div className="plan-grid">
        <section className="plan-list" aria-label="ranked plan">
          {plan.companies.map((c) => (
            <CompanyCard key={c.companyId} c={c} now={now} />
          ))}
        </section>

        <aside className="raw-directory" aria-label="the raw alternative">
          <h2>The raw alternative</h2>
          <p className="muted small">
            {directory.length} speakers/attendees, unranked — what you&apos;d scroll
            without a plan.
          </p>
          <ol className="raw-names">
            {directory.map((p) => (
              <li key={p.id}>
                <span className="raw-name">{p.name}</span>
                {p.title ? <span className="raw-title"> · {p.title}</span> : null}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}

function Chip({ provenance, now }: { provenance: Provenance; now: Date }) {
  const thin = provenance.confidence === "thin";
  return (
    <span className="prov-chip" data-thin={thin} title={thin ? "thin signal — verify" : undefined}>
      {formatChip(provenance, now)}
    </span>
  );
}

function CompanyCard({ c, now }: { c: PlannedCompany; now: Date }) {
  return (
    <article className="company-card">
      <div className="card-head">
        <span className="rank">{c.rank}</span>
        <div className="card-title">
          <h3>
            {c.name}
            {c.domain ? (
              <a className="domain" href={`https://${c.domain}`} target="_blank" rel="noreferrer">
                {c.domain} ↗
              </a>
            ) : null}
          </h3>
          <p className="why">{c.whyLine}</p>
        </div>
        <span className="score" title="Career Mover fit score">
          {Math.round(c.score * 100)}
        </span>
      </div>

      {c.claims.length ? (
        <ul className="claims">
          {c.claims.map((claim, i) => (
            <li key={i}>
              <span className="claim-label">{claim.label}</span>
              <span className="claim-text">{claim.text}</span>
              <Chip provenance={claim.provenance} now={now} />
            </li>
          ))}
        </ul>
      ) : null}

      {c.whoToMeet.length ? (
        <div className="who">
          <span className="section-label">Who to meet</span>
          <ul>
            {c.whoToMeet.map((p) => (
              <li key={p.personId}>
                <span className="who-name">
                  {p.linkedinUrl ? (
                    <a href={p.linkedinUrl} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </span>
                {p.title ? <span className="who-title"> · {p.title}</span> : null}
                {p.speaking && p.talk ? (
                  <span className="speaking">
                    🎤 {[p.talk.day, p.talk.time, p.talk.room].filter(Boolean).join(" · ")}
                  </span>
                ) : (
                  <span className="attending">attending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.openRoles.length ? (
        <div className="roles">
          <span className="section-label">Open roles ({c.openRoles.length})</span>{" "}
          {c.openRoles.slice(0, 4).map((r, i) => (
            <span key={r.roleId} className="role-pill">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              ) : (
                r.title
              )}
              {i < Math.min(4, c.openRoles.length) - 1 ? "" : ""}
            </span>
          ))}
        </div>
      ) : null}

      <div className="opener">
        <span className="section-label">Draft opener</span>
        <p>{c.opener}</p>
        <CopyButton text={c.opener} />
      </div>
    </article>
  );
}
