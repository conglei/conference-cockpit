import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { createCompanyRepo } from "@/db/repository";
import { createPersonRepo } from "@/db/people-repository";
import { createTalkRepo } from "@/db/talk-repository";
import { personProvenance, formatChip, isThin } from "@/provenance";
import { readDeepDive } from "@/enrich/read";
import Avatar from "../../_components/Avatar";

// The DB + markdown files are read at request time, not build time.
export const dynamic = "force-dynamic";

/** Parse a JSON list of {title/role, company, dates} entries; tolerate plain text. */
type Entry = { title: string; org?: string; when?: string };
function asEntries(v: string | null | undefined): Entry[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) {
      return parsed
        .map((e): Entry | null => {
          if (typeof e === "string") return { title: e };
          if (e && typeof e === "object") {
            const title = e.title ?? e.role ?? e.degree ?? e.school ?? e.name ?? "";
            const org = e.company ?? e.organization ?? e.school ?? e.org ?? undefined;
            const when = e.dates ?? e.duration ?? e.years ?? e.when ?? undefined;
            if (!title && !org) return null;
            return { title: String(title || org), org: title ? org : undefined, when };
          }
          return null;
        })
        .filter((e): e is Entry => e !== null);
    }
  } catch {
    /* not JSON */
  }
  return [];
}

const FOUNDER_RE = /founder|ceo|chief|cto|president|partner/i;

export default async function PersonBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const person = await createPersonRepo(db).getBySlug(slug);
  if (!person) notFound();

  const now = new Date();
  const company =
    person.companyId != null
      ? await createCompanyRepo(db).get(person.companyId)
      : undefined;
  const talks = await createTalkRepo(db).bySpeaker(person.id);
  const markdown = readDeepDive(person.notesPath);
  const prov = personProvenance(person);

  const isFounder = FOUNDER_RE.test(person.title ?? "") || person.relationship === "founder";
  const speaking = talks.length > 0;
  const canRefer = person.connectionDegree === 1 && person.canRefer;

  // "Why meet them" — synthesized from the strongest signals we have.
  const reasons: string[] = [];
  if (isFounder && company) reasons.push(`Founder / leadership at ${company.name}`);
  else if (isFounder) reasons.push("Founder / leadership");
  if (speaking)
    reasons.push(`Speaking — ${talks[0].title}${talks[0].day ? ` (${talks[0].day})` : ""}`);
  if (canRefer) reasons.push("1st-degree connection — could open a warm intro");
  if (!reasons.length) reasons.push("Attending — a contact at a target company");

  const bio = person.about || person.bio || null;
  const work = asEntries(person.workHistory);
  const education = asEntries(person.education);

  return (
    <main className="brief">
      <nav className="brief-back">
        {company ? (
          <a href={`/companies/${company.slug}`}>← {company.name}</a>
        ) : (
          <a href="/companies">← Companies</a>
        )}
      </nav>

      {/* ---- Hero ---- */}
      <header className="person-hero">
        <Avatar name={person.name} src={person.photoUrl} size={72} />
        <div className="person-hero-body">
          <h1>{person.name}</h1>
          <p className="person-hero-sub">
            {person.title ?? person.headline ?? ""}
            {company ? (
              <>
                {person.title || person.headline ? " · " : ""}
                <a href={`/companies/${company.slug}`}>{company.name}</a>
              </>
            ) : null}
          </p>
          <div className="person-hero-meta">
            {person.location ? (
              <span className="faint">{person.location}</span>
            ) : null}
            {isFounder ? <span className="badge badge-founder">Founder</span> : null}
            {speaking ? <span className="badge badge-speaking">Speaking</span> : null}
            {canRefer ? <span className="badge badge-warm">Can refer</span> : null}
            <span className="prov-chip" data-thin={isThin(prov, now)}>
              {formatChip(prov, now)}
            </span>
          </div>
        </div>
      </header>

      {/* ---- Why meet them ---- */}
      <section className="brief-section">
        <span className="section-label">Why meet them</span>
        <ul className="reason-list">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>

      {/* ---- Their talk(s) ---- */}
      {talks.length ? (
        <section className="brief-section">
          <span className="section-label">
            {talks.length > 1 ? "Their talks" : "Their talk"}
          </span>
          {talks.map((t) => (
            <article className="talk-card" key={t.id}>
              <h3>{t.title}</h3>
              <p className="talk-card-slot num">
                {[t.day, t.time, t.room, t.track].filter(Boolean).join(" · ")}
              </p>
              {t.description ? (
                <p className="talk-card-desc">{t.description}</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {/* ---- About ---- */}
      {bio ? (
        <section className="brief-section">
          <span className="section-label">About</span>
          <p className="brief-prose">{bio}</p>
        </section>
      ) : null}

      {/* ---- Background ---- */}
      {(work.length || education.length) > 0 ? (
        <section className="brief-section">
          <span className="section-label">Background</span>
          {work.length ? (
            <ul className="timeline">
              {work.map((e, i) => (
                <li key={`w-${i}`}>
                  <span className="timeline-title">{e.title}</span>
                  {e.org ? <span className="timeline-org"> · {e.org}</span> : null}
                  {e.when ? <span className="timeline-when num"> {e.when}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {education.length ? (
            <ul className="timeline timeline-edu">
              {education.map((e, i) => (
                <li key={`e-${i}`}>
                  <span className="timeline-title">{e.title}</span>
                  {e.org ? <span className="timeline-org"> · {e.org}</span> : null}
                  {e.when ? <span className="timeline-when num"> {e.when}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ---- Reach ---- */}
      {(person.linkedinUrl || person.twitterUrl || company) && (
        <section className="brief-section">
          <span className="section-label">Reach</span>
          <div className="reach-row">
            {person.linkedinUrl ? (
              <a className="reach-link" href={person.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn ↗
              </a>
            ) : null}
            {person.twitterUrl ? (
              <a className="reach-link" href={person.twitterUrl} target="_blank" rel="noreferrer">
                Twitter ↗
              </a>
            ) : null}
            {company?.domain ? (
              <a
                className="reach-link"
                href={`https://${company.domain}`}
                target="_blank"
                rel="noreferrer"
              >
                {company.domain} ↗
              </a>
            ) : null}
          </div>
        </section>
      )}

      {/* ---- Raw notes (progressive disclosure) ---- */}
      {markdown ? (
        <details className="brief-raw">
          <summary>Research notes (raw) — every source, unedited</summary>
          <pre>{markdown}</pre>
        </details>
      ) : null}
    </main>
  );
}
