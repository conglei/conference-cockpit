/**
 * Types for the conference plan engine (product-design.md §11 Phase 2).
 *
 * The MVP lens is **Career Mover, company-first**: the plan is ~8 ranked
 * companies, each with a fit-led (timing-as-garnish) why-line, nested who-to-meet
 * (the warm path in), open roles, a copy-ready opener, and talk logistics —
 * **every claim carrying provenance** (source + "as of"). The `Lens` interface is
 * the documented seam: a second lens (e.g. Recruiter, people-first) is a drop-in
 * scorer + output shaper over the *same* enriched graph.
 */
import type { Company, Person, Role, Talk } from "../db/schema";
import type { Provenance } from "../provenance";
import type { ScoreWeights, PrefilterCriteria } from "../scoring";

/** The portable goal profile — parsed from preferences.md (+ optional narrative). */
export interface GoalProfile {
  weights: ScoreWeights;
  prefilter: PrefilterCriteria;
  /** Free-text "who I am / what I want" (résumé/narrative) — seeds openers. */
  summary?: string;
}

/** A single sourced supporting fact attached to a planned company. */
export interface Claim {
  label: string;
  text: string;
  provenance: Provenance;
}

/** A talk slot rendered for logistics. */
export interface TalkSlot {
  title: string;
  day: string | null;
  time: string | null;
  room: string | null;
  track: string | null;
}

/** A person worth meeting at a target company — the nested warm path. */
export interface PersonToMeet {
  personId: number;
  name: string;
  title: string | null;
  speaking: boolean;
  talk?: TalkSlot;
  connectionDegree: number | null;
  linkedinUrl: string | null;
  provenance: Provenance;
}

export interface OpenRole {
  roleId: number;
  title: string;
  url: string | null;
  location: string | null;
  provenance: Provenance;
}

/** One company in the ranked plan (the atomic output unit — company-first). */
export interface PlannedCompany {
  rank: number;
  companyId: number;
  name: string;
  domain: string | null;
  /** Lens score ∈ [0,1]. */
  score: number;
  /** One-line fit thesis (+ a timing clause only when sourced). */
  whyLine: string;
  /** Sourced supporting facts (funding, roles, taste rationale, …). */
  claims: Claim[];
  whoToMeet: PersonToMeet[];
  openRoles: OpenRole[];
  /** Plain, copy-ready opener the user will rewrite. */
  opener: string;
  /** "Dhruv Batra speaks Day 3, 10:45am, Track 7" lines. */
  talkLogistics: string[];
}

/** The full plan: the ranked companies + how it was produced (for the UI header). */
export interface ConferencePlan {
  lens: string;
  generatedAt: number;
  consideredCompanies: number;
  companies: PlannedCompany[];
}

/** Read-side dependencies the lens composes over (the enriched graph). */
export interface PlanGraph {
  companies: Company[];
  rolesByCompany: (companyId: number) => Role[];
  peopleByCompany: (companyId: number) => Person[];
  talksBySpeaker: (speakerId: number) => Talk[];
}

export interface PlanContext {
  profile: GoalProfile;
  graph: PlanGraph;
  now: Date;
}

/** A lens's score for one company, with the contributions that explain it. */
export interface CompanyScore {
  score: number;
  /** Human-readable contributions, strongest first (seed the why-line). */
  contributions: string[];
}

/**
 * The lens seam. A lens re-ranks AND re-shapes the shared graph for one goal.
 * Career Mover is company-first; the lens decides the output *shape*, not just
 * the sort order.
 *
 * NOTE (ADR-0004): this interface is company-shaped (`scoreCompany` →
 * `PlannedCompany`). The decided direction makes the **Person** the atomic unit
 * (`scorePerson` → `PlannedPerson`, company demoted to an attribute). This seam
 * is therefore SUPERSEDED and will be reshaped when the people-first lens lands;
 * a people-first lens is NOT a drop-in over this interface.
 */
export interface Lens {
  key: string;
  label: string;
  /** Score one company for this goal (0 ⇒ excluded from the plan). */
  scoreCompany(company: Company, ctx: PlanContext): CompanyScore;
  /** Shape one scored company into the planned output unit. */
  buildPlanned(
    company: Company,
    score: CompanyScore,
    rank: number,
    ctx: PlanContext,
  ): PlannedCompany;
}
