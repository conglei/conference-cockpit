/**
 * Scoped, read-only data primitives for the agent (ADR-0005). NOT an intelligence
 * layer: `search*` returns a compact, projected, capped list so the agent can
 * narrow cheaply; `get*` returns the rich detail (with provenance) for the few it
 * shortlists. The agent does the ranking/curation. Pure over the repos so it is
 * fully unit-testable; the `query` CLI is a thin adapter over these, run against a
 * read-only DB connection. Write-back lives elsewhere (`conf-followup`).
 */
import type { PersonRepo } from "../db/people-repository";
import type { CompanyRepo, RoleRepo } from "../db/repository";
import type { TalkRepo } from "../db/talk-repository";
import type { Company, Person, Role } from "../db/schema";
import {
  companyFundingProvenance,
  companyIdentityProvenance,
  roleProvenance,
  personProvenance,
  formatChip,
  isThin,
} from "../provenance";

export interface QueryRepos {
  people: PersonRepo;
  companies: CompanyRepo;
  roles: RoleRepo;
  talks: TalkRepo;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

function clampLimit(n: number | undefined): number {
  if (!n || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
function offsetOf(cursor: number | string | undefined): number {
  const n = Number(cursor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function asList(v: string | null | undefined): string[] {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p.map(String).filter(Boolean);
  } catch {
    /* not json */
  }
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}
/** Role descriptions can be (double-)encoded HTML — decode + strip to prose. */
function cleanText(s: string | null): string | null {
  if (!s) return null;
  const t = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** Cap + paginate; every search returns this envelope so the agent can page. */
function page<T>(rows: T[], limit: number | undefined, cursor: number | string | undefined) {
  const off = offsetOf(cursor);
  const lim = clampLimit(limit);
  const items = rows.slice(off, off + lim);
  return { items, total: rows.length, nextCursor: off + lim < rows.length ? off + lim : null };
}

async function companyById(repos: QueryRepos) {
  return new Map((await repos.companies.list()).map((c) => [c.id, c]));
}

// ============================ PEOPLE ============================
export interface PeopleQuery {
  q?: string;
  vertical?: string;
  company?: string; // slug
  speaking?: boolean;
  limit?: number;
  cursor?: number | string;
}

export async function searchPeople(repos: QueryRepos, args: PeopleQuery = {}) {
  const byId = await companyById(repos);
  const needle = args.q?.trim().toLowerCase();
  const companyId = args.company ? (await repos.companies.getBySlug(args.company))?.id ?? -1 : undefined;

  const all = await repos.people.list();
  const rows: Person[] = [];
  for (const p of all) {
    if (companyId !== undefined && p.companyId !== companyId) continue;
    if (args.vertical && !asList(byId.get(p.companyId ?? -1)?.verticals).includes(args.vertical)) continue;
    if (args.speaking != null && (await repos.talks.bySpeaker(p.id)).length > 0 !== args.speaking) continue;
    if (needle) {
      const co = p.companyId != null ? byId.get(p.companyId)?.name ?? "" : "";
      const hay = `${p.name} ${p.title ?? ""} ${p.headline ?? ""} ${p.currentCompany ?? ""} ${co}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    rows.push(p);
  }

  const { items, total, nextCursor } = page(rows, args.limit, args.cursor);
  return { total, nextCursor, people: await Promise.all(items.map((p) => peopleCompact(p, repos))) };
}

async function peopleCompact(p: Person, repos: QueryRepos) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    title: p.title,
    company: p.currentCompany,
    headline: p.headline,
    location: p.location,
    speaking: (await repos.talks.bySpeaker(p.id)).length > 0,
    saved: p.outreachStatus === "targeted",
  };
}

export async function getPerson(repos: QueryRepos, idOrSlug: string | number) {
  const person =
    typeof idOrSlug === "number"
      ? await repos.people.get(idOrSlug)
      : ((await repos.people.getBySlug(idOrSlug)) ?? (Number.isFinite(Number(idOrSlug)) ? await repos.people.get(Number(idOrSlug)) : undefined));
  if (!person) return null;
  const company = person.companyId != null ? await repos.companies.get(person.companyId) : undefined;
  const now = new Date();
  return {
    id: person.id,
    slug: person.slug,
    name: person.name,
    title: person.title,
    headline: person.headline,
    location: person.location,
    bio: person.about ?? person.bio ?? null,
    workHistory: person.workHistory ?? null,
    education: person.education ?? null,
    linkedinUrl: person.linkedinUrl,
    twitterUrl: person.twitterUrl,
    company: company ? { slug: company.slug, name: company.name } : null,
    talks: (await repos.talks.bySpeaker(person.id)).map((t) => ({
      title: t.title, day: t.day, time: t.time, room: t.room, track: t.track,
    })),
    saved: person.outreachStatus === "targeted",
    outreachStatus: person.outreachStatus,
    source: formatChip(personProvenance(person, now), now),
  };
}

// ============================ COMPANIES ============================
export interface CompanyQuery {
  q?: string;
  vertical?: string;
  hiring?: boolean;
  limit?: number;
  cursor?: number | string;
}

export async function searchCompanies(repos: QueryRepos, args: CompanyQuery = {}) {
  const counts = new Map<number, number>();
  for (const r of await repos.roles.list()) counts.set(r.companyId, (counts.get(r.companyId) ?? 0) + 1);
  const needle = args.q?.trim().toLowerCase();
  const rows = (await repos.companies.list()).filter((c) => {
    const v = asList(c.verticals);
    if (args.hiring && (counts.get(c.id) ?? 0) === 0) return false;
    if (args.vertical && !v.includes(args.vertical)) return false;
    if (needle) {
      const hay = `${c.name} ${c.domain ?? ""} ${c.industry ?? ""} ${v.join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const { items, total, nextCursor } = page(rows, args.limit, args.cursor);
  return {
    total,
    nextCursor,
    companies: items.map((c) => ({
      slug: c.slug,
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      verticals: asList(c.verticals).slice(0, 4),
      stage: c.stage,
      location: c.location,
      openRoles: counts.get(c.id) ?? 0,
    })),
  };
}

export async function getCompany(repos: QueryRepos, slug: string) {
  const c = await repos.companies.getBySlug(slug);
  if (!c) return null;
  const now = new Date();
  return {
    slug: c.slug,
    name: c.name,
    domain: c.domain,
    description: c.description,
    industry: c.industry,
    verticals: asList(c.verticals),
    stage: c.stage,
    location: c.location,
    headcount: c.headcount != null ? String(c.headcount) : c.sizeBand,
    foundedYear: c.foundedYear,
    funding: {
      latestRound: c.latestRound,
      latestAmount: c.latestAmount,
      total: c.fundingTotal,
      leadInvestor: c.leadInvestor,
      lastFundingDate: c.lastFundingDate,
      source: formatChip(companyFundingProvenance(c, now), now),
    },
    identitySource: formatChip(companyIdentityProvenance(c, now), now),
    people: (await repos.people.listByCompany(c.id)).map((p) => ({ slug: p.slug, name: p.name, title: p.title })),
    openRoles: (await repos.roles.list({ companyId: c.id })).length,
  };
}

// ============================ ROLES ============================
export interface RoleQuery {
  q?: string;
  workType?: string;
  company?: string; // slug
  limit?: number;
  cursor?: number | string;
}

export async function searchRoles(repos: QueryRepos, args: RoleQuery = {}) {
  const byId = await companyById(repos);
  const needle = args.q?.trim().toLowerCase();
  const companyId = args.company ? (await repos.companies.getBySlug(args.company))?.id ?? -1 : undefined;
  const rows = (await repos.roles
    .list(companyId !== undefined ? { companyId } : undefined))
    .filter((r) => {
      if (args.workType && r.workType !== args.workType) return false;
      if (needle) {
        const co = byId.get(r.companyId)?.name ?? "";
        if (!`${r.title} ${co} ${r.location ?? ""}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.postedDate ?? "").localeCompare(a.postedDate ?? "")); // newest first
  const { items, total, nextCursor } = page(rows, args.limit, args.cursor);
  return {
    total,
    nextCursor,
    roles: items.map((r) => roleCompact(r, byId)),
  };
}

function roleCompact(r: Role, byId: Map<number, Company>) {
  const c = byId.get(r.companyId);
  return {
    id: r.id,
    title: r.title,
    company: c ? { slug: c.slug, name: c.name } : null,
    location: r.location,
    workType: r.workType,
    postedDate: r.postedDate,
  };
}

export async function getRole(repos: QueryRepos, id: number) {
  const r = await repos.roles.get(id);
  if (!r) return null;
  const c = await repos.companies.get(r.companyId);
  const now = new Date();
  const prov = roleProvenance(r, now);
  return {
    id: r.id,
    title: r.title,
    company: c ? { slug: c.slug, name: c.name } : null,
    location: r.location,
    workType: r.workType,
    salary: r.salary,
    url: r.url,
    postedDate: r.postedDate,
    description: cleanText(r.description),
    source: formatChip(prov, now),
    thin: isThin(prov, now),
  };
}

// ============================ FACETS ============================
export async function listVerticals(repos: QueryRepos) {
  const counts = new Map<string, number>();
  for (const c of await repos.companies.list()) {
    for (const v of asList(c.verticals)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return {
    verticals: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([vertical, companies]) => ({ vertical, companies })),
  };
}
