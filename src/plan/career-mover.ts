/**
 * The **Career Mover** lens (product-design.md §11 Phase 2) — the one populated
 * lens of the MVP. Company-first: it ranks the enriched graph for a job-seeker
 * and shapes each target into "why this company + who to meet + how to open it."
 *
 * Ranking = the persisted taste sub-scores (founder/investor co-dominant, the
 * judgment made upstream by the score-companies skill) **recombined under the
 * goal profile's weights**, plus honest, provenance-penalized garnish: a small
 * boost for a *recently sourced* raise (timing) and for actively-open roles. Fit
 * leads; timing never manufactured (§8 risk #2).
 */
import type { Company } from "../db/schema";
import {
  combineOverall,
  type SubScores,
} from "../scoring";
import {
  companyFundingProvenance,
  personProvenance,
  rankPenalty,
  roleProvenance,
  makeProvenance,
  freshness,
  type Provenance,
} from "../provenance";
import type {
  CompanyScore,
  Lens,
  PersonToMeet,
  PlanContext,
  PlannedCompany,
  Claim,
  OpenRole,
} from "./types";

const MAX_PEOPLE = 5;
const MAX_ROLES = 6;
/** A raise counts as a *timing* signal only if dated within this window. */
const TIMING_WINDOW_DAYS = 180;

function subScores(c: Company): SubScores {
  return {
    founder_quality: c.scoreFounderQuality,
    investor_quality: c.scoreInvestorQuality,
    domain_fit: c.scoreDomainFit,
    stage_fit: c.scoreStageFit,
    size_fit: c.scoreSizeFit,
  };
}

const hasAnySub = (s: SubScores): boolean =>
  Object.values(s).some((v) => v !== null && v !== undefined);

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

/** True when the company has a funding date inside the timing window. */
function recentRaise(c: Company, now: Date): boolean {
  if (!c.lastFundingDate) return false;
  const f = freshness(c.lastFundingDate, now);
  return f.ageDays != null && f.ageDays <= TIMING_WINDOW_DAYS;
}

export const careerMoverLens: Lens = {
  key: "career-mover",
  label: "Career Mover",

  scoreCompany(company, ctx): CompanyScore {
    const sub = subScores(company);
    // Fit base: recombine sub-scores under the goal weights; fall back to the
    // persisted overall when sub-scores are absent; 0 ⇒ excluded from the plan.
    let base = 0;
    if (hasAnySub(sub)) base = combineOverall(sub, ctx.profile.weights);
    else if (company.scoreOverall != null) base = company.scoreOverall;
    if (base <= 0) return { score: 0, contributions: [] };

    const contributions: string[] = [];
    if ((sub.founder_quality ?? 0) >= 0.7) contributions.push("elite founders");
    if ((sub.investor_quality ?? 0) >= 0.7) contributions.push("strong cap table");
    if ((sub.domain_fit ?? 0) >= 0.7) contributions.push("on-target domain");

    // Garnish 1 — actively hiring (a job-seeker wants open doors). +0.04.
    const openRoles = ctx.graph.rolesByCompany(company.id);
    let boost = 0;
    if (openRoles.length > 0) {
      boost += 0.04;
      contributions.push(`${openRoles.length} open role${openRoles.length > 1 ? "s" : ""}`);
    }
    // Garnish 2 — recent raise (timing), penalized by funding provenance. ≤+0.05.
    if (recentRaise(company, ctx.now)) {
      const prov = companyFundingProvenance(company, ctx.now);
      boost += 0.05 * rankPenalty(prov, ctx.now);
      contributions.push(`raised ${company.latestRound ?? "recently"}`);
    }

    const score = Math.min(1, base + boost);
    return { score, contributions };
  },

  buildPlanned(company, score, rank, ctx): PlannedCompany {
    const claims: Claim[] = [];

    // Taste rationale — the upstream judgment, dated by when it was scored.
    if (company.scoreRationale) {
      claims.push({
        label: "Why (taste)",
        text: company.scoreRationale,
        provenance: makeProvenance("llm", company.scoredAt ?? null, ctx.now),
      });
    }
    // Funding — Apollo-sourced, dated by the round.
    const fundingText = [company.latestRound, company.latestAmount]
      .filter(Boolean)
      .join(", ");
    if (fundingText || company.fundingTotal) {
      const parts = [fundingText, company.fundingTotal ? `${company.fundingTotal} total` : ""]
        .filter(Boolean)
        .join(" · ");
      claims.push({
        label: "Funding",
        text: parts || "funding on file",
        provenance: companyFundingProvenance(company, ctx.now),
      });
    }

    // Open roles (the doorway).
    const roles = ctx.graph.rolesByCompany(company.id);
    const openRoles: OpenRole[] = roles.slice(0, MAX_ROLES).map((r) => ({
      roleId: r.id,
      title: r.title,
      url: r.url,
      location: r.location,
      provenance: roleProvenance(r, ctx.now),
    }));
    if (roles.length) {
      claims.push({
        label: "Open roles",
        text: `${roles.length} open (e.g. ${roles[0].title})`,
        provenance: roleProvenance(roles[0], ctx.now),
      });
    }

    // Who to meet — speakers at this company first (the warm path).
    const people = ctx.graph.peopleByCompany(company.id);
    const whoToMeet: PersonToMeet[] = people
      .map((p): PersonToMeet => {
        const talks = ctx.graph.talksBySpeaker(p.id);
        const t = talks[0];
        return {
          personId: p.id,
          name: p.name,
          title: p.title,
          speaking: talks.length > 0,
          talk: t
            ? { title: t.title, day: t.day, time: t.time, room: t.room, track: t.track }
            : undefined,
          connectionDegree: p.connectionDegree,
          linkedinUrl: p.linkedinUrl,
          provenance: personProvenance(p, ctx.now),
        };
      })
      .sort((a, b) => {
        if (a.speaking !== b.speaking) return a.speaking ? -1 : 1;
        return (a.connectionDegree ?? 99) - (b.connectionDegree ?? 99);
      })
      .slice(0, MAX_PEOPLE);

    const talkLogistics = whoToMeet
      .filter((p) => p.speaking && p.talk)
      .map(
        (p) =>
          `${p.name} speaks ${[p.talk!.day, p.talk!.time, p.talk!.room]
            .filter(Boolean)
            .join(", ")}` + (p.talk!.title ? ` — "${p.talk!.title}"` : ""),
      );

    const whyLine = buildWhyLine(company, score, ctx);
    const opener = buildOpener(company, whoToMeet, ctx);

    return {
      rank,
      companyId: company.id,
      name: company.name,
      domain: company.domain,
      score: score.score,
      whyLine,
      claims,
      whoToMeet,
      openRoles,
      opener,
      talkLogistics,
    };
  },
};

/** Fit thesis first; a timing clause only when the raise is recent + sourced. */
function buildWhyLine(company: Company, score: CompanyScore, ctx: PlanContext): string {
  const fit = score.contributions.filter(
    (c) => !c.startsWith("raised") && !c.endsWith("roles") && !c.endsWith("role"),
  );
  const lead =
    fit.length > 0
      ? fit.join(" + ")
      : company.scoreRationale
        ? company.scoreRationale.split(/[.;]/)[0]
        : `${company.category ?? "AI"} company that fits your taste`;
  const clauses = [cap(lead)];
  const roles = ctx.graph.rolesByCompany(company.id);
  if (roles.length) clauses.push(`${roles.length} open role${roles.length > 1 ? "s" : ""}`);
  if (recentRaise(company, ctx.now) && company.latestRound) {
    const f = freshness(company.lastFundingDate, ctx.now);
    clauses.push(`raised ${company.latestRound} (${f.label})`);
  }
  return clauses.join(" · ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A plain, clearly-a-draft opener grounded in real data. */
function buildOpener(
  company: Company,
  whoToMeet: PersonToMeet[],
  ctx: PlanContext,
): string {
  const speaker = whoToMeet.find((p) => p.speaking && p.talk);
  const me = ctx.profile.summary ? "" : "";
  void me;
  if (speaker) {
    return `Hi ${firstName(speaker.name)} — planning to catch your talk "${speaker.talk!.title}" at AIE. I'm a founding engineer exploring my next thing and ${company.name}'s work is right in my wheelhouse; would love to say hi after.`;
  }
  const hook = company.latestRound
    ? `your recent ${company.latestRound}`
    : company.category
      ? `what you're building in ${company.category}`
      : `what you're building`;
  return `Hi — I've been following ${company.name} (${hook}). I'm a founding engineer looking at my next move and would love to trade notes at AIE.`;
}
