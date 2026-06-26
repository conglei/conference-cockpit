/**
 * People-first `who-to-meet` (ADR-0004). Ranks the *person* directly over the
 * whole enriched graph — not gated by a company top-N — using the per-person
 * signals the enrichment unlocked:
 *
 *   - **Pedigree** (the founder-bar): top-lab / big-tech in `work_history`, a PhD
 *     or research title in `education` / `headline`, a founder/exec title.
 *   - **Warm path**: connection degree, can-refer, and *shared employer/school*
 *     between the user (resume) and the person.
 *   - **Reachability**: are they speaking? a talk slot is a concrete place/time.
 *   - **Role fit**: technical IC / leadership (the Career Mover taste).
 *   - **Company fit** (a feature, not a gate): the employer's taste score + a
 *     match against the user's target verticals.
 *
 * Pure: `rankPeople` takes plain data so it is fully unit-testable; the CLI wires
 * the DB repos into it. Weights are transparent internal constants (v1) — the
 * `contributions` list always explains a score.
 */
import type { Company, Person, Talk } from "../db/schema";
import { personProvenance, type Provenance } from "../provenance";
import type { GoalProfile, PlannedPerson, TalkSlot } from "./types";

/** The user's background, for shared-employer/school warm paths (from resume). */
export interface UserBackground {
  employers: string[];
  schools: string[];
}

const SCHOOL_WORDS = ["university", "college", "institute", "school", "polytechnic"];

/**
 * Best-effort parse of employers + schools from a résumé. Reads the right-hand
 * side of "<role/degree> — <org>" lines (the format in profile/resume.md),
 * stripping trailing date parentheses, and classifies each org as a school (if
 * it reads like one) or an employer.
 */
export function extractBackground(resume: string | undefined): UserBackground {
  const employers = new Set<string>();
  const schools = new Set<string>();
  if (!resume) return { employers: [], schools: [] };
  for (const raw of resume.split(/\n/)) {
    // Split only on an em/en dash (the role–org separator); an ASCII hyphen also
    // appears inside date ranges like "(2010 - 2014)", so it must NOT split here.
    const m = raw.split(/\s+[—–]\s+/);
    if (m.length < 2) continue;
    // The left side is a short role/degree label, not a prose bullet. This is what
    // distinguishes "Software Engineer — Airbnb" from a sentence that merely
    // contains an em dash.
    if (m[0].trim().split(/\s+/).length > 8) continue;
    const org = m[1].replace(/\s*\([^)]*\)\s*$/, "").trim(); // the org after the first dash
    if (!org || org.length < 2 || org.length > 60 || org.split(/\s+/).length > 8 || /\d{4}/.test(org))
      continue;
    const low = org.toLowerCase();
    if (SCHOOL_WORDS.some((w) => low.includes(w))) schools.add(org);
    else employers.add(org);
  }
  return { employers: [...employers], schools: [...schools] };
}

/** Plain read-side data the ranker composes over (the people-centric graph). */
export interface PeopleGraph {
  people: Person[];
  companyById: (id: number | null) => Company | undefined;
  talksBySpeaker: (speakerId: number) => Talk[];
}

export interface RankPeopleOptions {
  limit?: number;
  /** Keep only people whose company verticals or talk track include this. */
  vertical?: string;
  /** Keep only people with a talk slot (speaking). */
  speakingOnly?: boolean;
}

// --- pedigree vocabularies (lower-cased substring match on work_history) ---
const TOP_LABS = ["openai", "deepmind", "google brain", "fair", "meta ai", "anthropic"];
const BIG_TECH = [
  "google", "meta", "facebook", "amazon", "aws", "microsoft", "apple", "nvidia",
  "stripe", "airbnb", "uber", "netflix", "databricks", "salesforce", "tesla", "linkedin",
];
const RESEARCH = ["phd", "ph.d", "doctor of philosophy"];
const RESEARCH_TITLE = ["professor", "research scientist", "phd"];
const FOUNDER_EXEC = ["founder", "co-founder", "cofounder", "ceo", "cto", "chief"];
const TECHNICAL = [
  "engineer", "engineering", "member of technical staff", "mts", "swe", "architect",
  "ml ", "ai ", "research", "developer", "infrastructure", "staff", "principal",
];
const NON_ENG = ["product manager", "designer", "design ", "sales", "marketing", "recruit", "growth", "biz dev", "business development"];

/**
 * An **Objective** is the intent expressed as signal weights (ADR-0004: the lens
 * is an objective over people). Same engine, different goal — Career Mover prizes
 * founder-bar pedigree; Learner prizes on-topic depth and reachability (you learn
 * by attending the talk), and deliberately downweights ex-FAANG pedigree.
 */
export interface Objective {
  key: string;
  label: string;
  wTopLab: number;
  wBigTech: number;
  wResearch: number;
  wFounderExec: number;
  wTechnical: number;
  wNonEngPenalty: number;
  wConn1: number;
  wConn2: number;
  wCanRefer: number;
  wSharedEach: number;
  wSharedCap: number;
  wSpeaking: number;
  /** Boost when the person's OWN talk is in the requested vertical. */
  wDomainMatch: number;
  wCompanyTaste: number;
}

export const CAREER_MOVER: Objective = {
  key: "career-mover", label: "Career Mover",
  wTopLab: 0.45, wBigTech: 0.3, wResearch: 0.15, wFounderExec: 0.1,
  wTechnical: 0.1, wNonEngPenalty: 0.1,
  wConn1: 0.15, wConn2: 0.08, wCanRefer: 0.1, wSharedEach: 0.08, wSharedCap: 0.16,
  wSpeaking: 0.1, wDomainMatch: 0, wCompanyTaste: 0.1,
};

export const LEARNER: Objective = {
  key: "learner", label: "Learner",
  wTopLab: 0.1, wBigTech: 0.05, wResearch: 0.25, wFounderExec: 0.2,
  wTechnical: 0.05, wNonEngPenalty: 0,
  wConn1: 0.05, wConn2: 0.02, wCanRefer: 0, wSharedEach: 0.03, wSharedCap: 0.06,
  wSpeaking: 0.3, wDomainMatch: 0.3, wCompanyTaste: 0,
};

export const OBJECTIVES: Record<string, Objective> = {
  "career-mover": CAREER_MOVER,
  learner: LEARNER,
};

export function getObjective(key: string | undefined): Objective {
  return OBJECTIVES[(key ?? "career-mover").toLowerCase()] ?? CAREER_MOVER;
}

/** A scored person, ready to shape into a PlannedPerson. */
interface Scored {
  person: Person;
  score: number;
  contributions: string[];
  pedigree: string[];
  shared: string[];
  talks: Talk[];
  company: Company | undefined;
}

function has(hay: string | null | undefined, needles: string[]): string | undefined {
  if (!hay) return undefined;
  const h = hay.toLowerCase();
  return needles.find((n) => h.includes(n));
}

/** Parsed work_history entries (lower-cased company + end label). */
function workEntries(workHistory: string | null): Array<{ company: string; end: string }> {
  if (!workHistory) return [];
  try {
    const arr = JSON.parse(workHistory) as Array<{ company?: string; end?: string }>;
    return arr
      .map((e) => ({ company: (e.company ?? "").toLowerCase(), end: (e.end ?? "").toLowerCase() }))
      .filter((e) => e.company);
  } catch {
    return [];
  }
}

/** All company names in the work history (for warm-path shared-employer match). */
function workCompanies(workHistory: string | null): string[] {
  return workEntries(workHistory).map((e) => e.company);
}

/**
 * PAST employers only — excludes the current company and any still-current role
 * ("Present"). "ex-OpenAI" should never fire for someone *currently* at OpenAI.
 */
function pastCompanies(workHistory: string | null, currentName: string): string {
  const cur = currentName.toLowerCase();
  return workEntries(workHistory)
    .filter((e) => e.end !== "present" && !(cur && (e.company.includes(cur) || cur.includes(e.company))))
    .map((e) => e.company)
    .join(" | ");
}

function schoolNames(education: string | null): string[] {
  if (!education) return [];
  try {
    const arr = JSON.parse(education) as Array<{ school?: string }>;
    return arr.map((e) => (e.school ?? "").toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Score one person ∈ [0,1] for the Career Mover taste, people-first. Additive +
 * transparent: every positive term pushes a `contributions` string.
 */
export function scorePerson(
  person: Person,
  ctx: {
    graph: PeopleGraph;
    profile: GoalProfile;
    background: UserBackground;
    now: Date;
    objective?: Objective;
    /** Target vertical for the domain-match signal (usually opts.vertical). */
    vertical?: string;
  },
): Scored {
  const o = ctx.objective ?? CAREER_MOVER;
  const company = ctx.graph.companyById(person.companyId);
  const talks = ctx.graph.talksBySpeaker(person.id);
  const contributions: string[] = [];
  const pedigree: string[] = [];
  const shared: string[] = [];
  let score = 0;

  const headline = person.headline ?? person.title ?? "";
  const currentName = person.currentCompany ?? company?.name ?? "";

  // --- Pedigree (the founder-bar) — PAST employers only, never the current one ---
  const past = pastCompanies(person.workHistory, currentName);
  const lab = has(past, TOP_LABS);
  const big = !lab && has(past, BIG_TECH);
  if (lab) {
    score += o.wTopLab;
    pedigree.push(`ex-${prettyOrg(lab)}`);
    contributions.push(`ex-${prettyOrg(lab)}`);
  } else if (big) {
    score += o.wBigTech;
    pedigree.push(`ex-${prettyOrg(big)}`);
    contributions.push(`ex-${prettyOrg(big)}`);
  }
  if (has(person.education, RESEARCH) || has(headline, RESEARCH_TITLE)) {
    score += o.wResearch;
    pedigree.push("PhD/research");
    contributions.push("PhD / research");
  }
  if (has(headline, FOUNDER_EXEC) || has(person.workHistory, FOUNDER_EXEC)) {
    score += o.wFounderExec;
    pedigree.push("founder/exec");
    contributions.push("founder/exec");
  }

  // --- Role fit (Career Mover likes technical IC/leadership) ---
  if (has(headline, TECHNICAL)) score += o.wTechnical;
  else if (has(headline, NON_ENG)) score -= o.wNonEngPenalty;

  // --- Domain match — their OWN talk is in the requested vertical (intent-relevant) ---
  const vert = ctx.vertical?.toLowerCase();
  if (vert && talks.some((t) => (t.track ?? "").toLowerCase().includes(vert))) {
    score += o.wDomainMatch;
    if (o.wDomainMatch > 0) contributions.push(`on-topic: ${ctx.vertical}`);
  }

  // --- Warm path ---
  if (person.connectionDegree === 1) {
    score += o.wConn1;
    contributions.push("1st-degree connection");
  } else if (person.connectionDegree === 2) {
    score += o.wConn2;
    contributions.push("2nd-degree connection");
  }
  if (person.canRefer) {
    score += o.wCanRefer;
    contributions.push("can refer");
  }
  const employers = new Set(workCompanies(person.workHistory));
  for (const e of ctx.background.employers) {
    if ([...employers].some((c) => c.includes(e.toLowerCase()) || e.toLowerCase().includes(c))) {
      shared.push(`worked at ${e}`);
    }
  }
  const schools = new Set(schoolNames(person.education));
  for (const s of ctx.background.schools) {
    if ([...schools].some((c) => c.includes(s.toLowerCase()) || s.toLowerCase().includes(c))) {
      shared.push(`studied at ${s}`);
    }
  }
  if (shared.length) {
    score += Math.min(o.wSharedCap, o.wSharedEach * shared.length);
    contributions.push(...shared);
  }

  // --- Reachability (a talk = a concrete time/place to meet) ---
  if (talks.length > 0) {
    score += o.wSpeaking;
    const t = talks[0];
    contributions.push(`speaking ${[t.day, t.time, t.room].filter(Boolean).join(", ")}`.trim());
  }

  // --- Company fit (feature, not gate) ---
  if (company?.scoreOverall != null) score += o.wCompanyTaste * company.scoreOverall;
  const verticals = parseVerticals(company);
  if (verticals.length) {
    contributions.push(verticals[0]);
  }

  return { person, score: clamp01(score), contributions, pedigree, shared, talks, company };
}

/** Rank everyone, apply filters, shape into PlannedPerson. */
export function rankPeople(
  ctx: {
    graph: PeopleGraph;
    profile: GoalProfile;
    background: UserBackground;
    now: Date;
    objective?: Objective;
  },
  opts: RankPeopleOptions = {},
): PlannedPerson[] {
  const limit = opts.limit ?? 12;
  const vert = opts.vertical?.toLowerCase();

  let scored = ctx.graph.people.map((p) => scorePerson(p, { ...ctx, vertical: opts.vertical }));

  if (opts.speakingOnly) scored = scored.filter((s) => s.talks.length > 0);
  if (vert) {
    scored = scored.filter((s) => {
      // Their OWN talk is in the track — the strongest, most precise signal.
      const inTalk = s.talks.some((t) => (t.track ?? "").toLowerCase().includes(vert));
      // Or their company is FOCUSED on the vertical (≤3 verticals) — excludes
      // generalist labs (e.g. Anthropic, 6 verticals) flooding via one colleague.
      const cv = parseVerticals(s.company);
      const focusedMatch = cv.length > 0 && cv.length <= 3 && cv.some((v) => v.toLowerCase().includes(vert));
      return inTalk || focusedMatch;
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s, i) => shape(s, i + 1, ctx.now));
}

function shape(s: Scored, rank: number, now: Date): PlannedPerson {
  const t = s.talks[0];
  const talk: TalkSlot | undefined = t
    ? { title: t.title, day: t.day, time: t.time, room: t.room, track: t.track }
    : undefined;
  return {
    rank,
    personId: s.person.id,
    slug: s.person.slug,
    name: s.person.name,
    photoUrl: s.person.photoUrl ?? null,
    headline: s.person.headline ?? s.person.title,
    currentCompany: s.person.currentCompany ?? s.company?.name ?? null,
    companyId: s.person.companyId,
    verticals: parseVerticals(s.company),
    score: Math.round(s.score * 1000) / 1000,
    whyLine: buildWhyLine(s),
    contributions: s.contributions,
    speaking: s.talks.length > 0,
    talk,
    warmPath: {
      connectionDegree: s.person.connectionDegree,
      canRefer: s.person.canRefer,
      shared: s.shared,
    },
    pedigree: s.pedigree,
    linkedinUrl: s.person.linkedinUrl,
    opener: buildOpener(s),
    provenance: personProvenance(s.person, now),
  };
}

function buildWhyLine(s: Scored): string {
  const lead = s.contributions.slice(0, 3);
  if (lead.length === 0) {
    return `${s.person.headline ?? s.person.title ?? "Attendee"}${s.company ? ` at ${s.company.name}` : ""}`;
  }
  return lead.map(cap).join(" · ");
}

function buildOpener(s: Scored): string {
  const first = s.person.name.split(/\s+/)[0] ?? s.person.name;
  const t = s.talks[0];
  const sharedClause = s.shared.length ? ` (we both ${s.shared[0]})` : "";
  if (t) {
    return `Hi ${first} — planning to catch your talk "${t.title}" at AIE${sharedClause}. I'm a founding engineer exploring my next thing; would love to say hi after.`;
  }
  const co = s.company?.name ?? s.person.currentCompany ?? "your team";
  return `Hi ${first} — I've been following the work at ${co}${sharedClause}. I'm a founding engineer looking at my next move and would love to trade notes at AIE.`;
}

function parseVerticals(company: Company | undefined): string[] {
  if (!company?.verticals) return [];
  try {
    const v = JSON.parse(company.verticals);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Proper-cased labels for the pedigree orgs (acronyms/camelCase done right). */
const ORG_LABELS: Record<string, string> = {
  openai: "OpenAI", deepmind: "DeepMind", "google brain": "Google Brain", fair: "FAIR",
  "meta ai": "Meta AI", anthropic: "Anthropic", google: "Google", meta: "Meta",
  facebook: "Meta", amazon: "Amazon", aws: "AWS", microsoft: "Microsoft", apple: "Apple",
  nvidia: "Nvidia", stripe: "Stripe", airbnb: "Airbnb", uber: "Uber", netflix: "Netflix",
  databricks: "Databricks", salesforce: "Salesforce", tesla: "Tesla", linkedin: "LinkedIn",
};
const prettyOrg = (token: string): string => ORG_LABELS[token] ?? titleCase(token);

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w === "ai" ? "AI" : cap(w)))
    .join(" ");
}
