import { readFileSync } from "node:fs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { createPersonRepo } from "@/db/people-repository";
import { createCompanyRepo } from "@/db/repository";
import { createTalkRepo } from "@/db/talk-repository";
import type { Person } from "@/db/schema";
import { loadGoalProfile } from "@/plan/profile";
import {
  buildOpener,
  extractBackground,
  getObjective,
  scorePerson,
  type PeopleGraph,
} from "@/plan/who-to-meet";
import { formatChip, personProvenance } from "@/provenance";
import Avatar from "../../_components/Avatar";
import CopyButton from "../../_components/CopyButton";

// Read the graph + profile at request time so a re-enrich shows up on refresh.
export const dynamic = "force-dynamic";

function readResume(): string | undefined {
  try {
    return readFileSync("profile/resume.md", "utf8");
  } catch {
    return undefined;
  }
}

/** photoUrl is a path on ai.engineer; absolute URLs pass through (Avatar handles 404). */
function photoSrc(u: string | null): string | null {
  if (!u) return null;
  return u.startsWith("http") ? u : `https://ai.engineer${u}`;
}

interface WorkRow {
  company?: string;
  title?: string;
  start?: string;
  end?: string;
}
interface EduRow {
  school?: string;
  degree?: string;
  field?: string;
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const person = createPersonRepo(getDb()).getBySlug(slug);
  if (!person) return { title: "Person not found · Conference Compass" };
  const sub = person.headline ?? person.title ?? "Attendee";
  return { title: `${person.name} — ${sub} · Conference Compass` };
}

export default async function PersonBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const db = getDb();
  const peopleRepo = createPersonRepo(db);
  const companyRepo = createCompanyRepo(db);
  const talkRepo = createTalkRepo(db);

  const person = peopleRepo.getBySlug(slug);
  if (!person) notFound();

  const company =
    person.companyId != null ? companyRepo.get(person.companyId) : undefined;
  const talks = talkRepo.bySpeaker(person.id);

  // Re-score this one person so the brief explains *why to meet* with the same
  // engine the ranked list uses — no separate, drift-prone logic.
  const allPeople = peopleRepo.list();
  const byId = new Map(companyRepo.list().map((c) => [c.id, c]));
  const graph: PeopleGraph = {
    people: allPeople,
    companyById: (id) => (id == null ? undefined : byId.get(id)),
    talksBySpeaker: (id) => talkRepo.bySpeaker(id),
  };
  const now = new Date();
  const scored = scorePerson(person, {
    graph,
    profile: loadGoalProfile(),
    background: extractBackground(readResume()),
    now,
    objective: getObjective("career-mover"),
  });
  const opener = buildOpener(scored);
  const reasons = scored.contributions;

  const work = parseJsonArray<WorkRow>(person.workHistory);
  const education = parseJsonArray<EduRow>(person.education);
  const prov = formatChip(personProvenance(person, now), now);

  const isFounder = person.relationship === "founder";
  const isSpeaking = talks.length > 0;
  const isWarm =
    person.connectionDegree === 1 ||
    person.connectionDegree === 2 ||
    person.canRefer;

  const companyName = person.currentCompany ?? company?.name ?? null;
  const reach = reachLinks(person);

  return (
    <main className="brief">
      <p className="brief-back">
        <a href="/">← Who to meet</a>
        {company ? (
          <>
            <span className="brief-back-sep">/</span>
            <a href={`/companies/${company.slug}`}>{company.name}</a>
          </>
        ) : null}
      </p>

      <header className="person-hero">
        <Avatar name={person.name} src={photoSrc(person.photoUrl)} size={72} />
        <div className="person-hero-body">
          <h1>{person.name}</h1>
          {person.headline || person.title ? (
            <p className="person-hero-sub">{person.headline ?? person.title}</p>
          ) : null}
          {companyName ? (
            <p className="person-hero-sub">
              {company ? (
                <a href={`/companies/${company.slug}`}>{companyName}</a>
              ) : (
                companyName
              )}
              {person.location ? (
                <span className="muted"> · {person.location}</span>
              ) : null}
            </p>
          ) : person.location ? (
            <p className="person-hero-sub muted">{person.location}</p>
          ) : null}

          {isFounder || isSpeaking || isWarm ? (
            <div className="person-hero-meta">
              {isFounder ? (
                <span className="badge badge-founder">Founder</span>
              ) : null}
              {isSpeaking ? (
                <span className="badge badge-speaking">🎤 Speaking</span>
              ) : null}
              {person.connectionDegree === 1 ? (
                <span className="badge badge-warm">1st-degree</span>
              ) : person.connectionDegree === 2 ? (
                <span className="badge badge-warm">2nd-degree</span>
              ) : null}
              {person.canRefer ? (
                <span className="badge badge-warm">Can refer</span>
              ) : null}
              <span className="prov-chip">{prov}</span>
            </div>
          ) : (
            <div className="person-hero-meta">
              <span className="prov-chip">{prov}</span>
            </div>
          )}
        </div>
      </header>

      {reasons.length ? (
        <section className="brief-section">
          <span className="section-label">Why meet</span>
          <ul className="reason-list">
            {reasons.map((r, i) => (
              <li key={`${r}-${i}`}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {isSpeaking ? (
        <section className="brief-section">
          <span className="section-label">
            Where to catch {firstName(person.name)}
          </span>
          {talks.map((t) => (
            <article key={t.id} className="talk-card">
              <h3>{t.title}</h3>
              <p className="talk-card-slot">
                {[t.day, t.time, t.room, t.track].filter(Boolean).join(" · ") ||
                  "Slot TBA"}
              </p>
              {t.description ? (
                <p className="talk-card-desc">{t.description}</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <section className="brief-section">
        <span className="section-label">Draft opener</span>
        <div className="opener">
          <p>{opener}</p>
          <CopyButton text={opener} />
        </div>
      </section>

      {person.about || person.bio ? (
        <section className="brief-section">
          <span className="section-label">About</span>
          <p className="brief-prose">{person.about ?? person.bio}</p>
        </section>
      ) : null}

      {work.length ? (
        <section className="brief-section">
          <span className="section-label">Experience</span>
          <ul className="timeline">
            {work.slice(0, 8).map((w, i) => (
              <li key={i}>
                {w.title ? <span className="timeline-title">{w.title}</span> : null}
                {w.company ? (
                  <span className="timeline-org">
                    {w.title ? " · " : ""}
                    {w.company}
                  </span>
                ) : null}
                {w.start || w.end ? (
                  <span className="timeline-when">
                    {" "}
                    {[w.start, w.end].filter(Boolean).join(" – ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {education.length ? (
        <section className="brief-section">
          <span className="section-label">Education</span>
          <ul className="timeline timeline-edu">
            {education.slice(0, 6).map((e, i) => (
              <li key={i}>
                {e.school ? <span className="timeline-title">{e.school}</span> : null}
                {e.degree || e.field ? (
                  <span className="timeline-org">
                    {e.school ? " · " : ""}
                    {[e.degree, e.field].filter(Boolean).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reach.length ? (
        <section className="brief-section">
          <span className="section-label">Reach out</span>
          <div className="reach-row">
            {reach.map((l) => (
              <a
                key={l.href}
                className="reach-link"
                href={l.href}
                target="_blank"
                rel="noreferrer"
              >
                {l.label}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function reachLinks(p: Person): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  if (p.linkedinUrl) out.push({ href: p.linkedinUrl, label: "LinkedIn ↗" });
  if (p.twitterUrl) out.push({ href: p.twitterUrl, label: "Twitter / X ↗" });
  return out;
}
