import type { Company, Person } from "../db/schema";
import type { Employee, WebSearchResult } from "../providers/types";

/** Context gathered while enriching, used to render the deep-dive markdown. */
export interface CompanyDeepDiveContext {
  company: Company;
  founders: Array<{ name: string; title?: string; linkedinUrl?: string }>;
  /** Supplementary web/funding context from `search`. */
  webContext: WebSearchResult[];
}

export interface PersonDeepDiveContext {
  person: Person;
  company?: Company;
  /** Raw provider profile payload, if any. */
  raw?: unknown;
}

function line(label: string, value: unknown): string {
  return `- **${label}:** ${value === undefined || value === null || value === "" ? "—" : value}`;
}

/** Render the `companies/<slug>.md` deep-dive for an enriched company. */
export function renderCompanyDeepDive(ctx: CompanyDeepDiveContext): string {
  const { company: c, founders, webContext } = ctx;
  const parts: string[] = [];

  parts.push(`# ${c.name}`);
  parts.push("");
  if (c.description) {
    parts.push(c.description);
    parts.push("");
  }

  parts.push("## Firmographics");
  parts.push(line("Domain", c.domain));
  parts.push(line("LinkedIn", c.linkedinUrl));
  parts.push(line("Website", c.websiteUrl));
  parts.push(line("Stage", c.stage));
  parts.push(line("Category", c.category));
  parts.push(line("Location", c.location));
  parts.push(line("Size band", c.sizeBand));
  parts.push("");

  parts.push("## Funding");
  parts.push(line("Latest round", c.latestRound));
  parts.push(line("Latest amount", c.latestAmount));
  parts.push(line("Last funding date", c.lastFundingDate));
  parts.push(line("Lead investor", c.leadInvestor));
  parts.push("");

  parts.push("## Founders & key people");
  if (founders.length === 0) {
    parts.push("_No founders/key people found._");
  } else {
    for (const f of founders) {
      const title = f.title ? ` — ${f.title}` : "";
      const link = f.linkedinUrl ? ` ([LinkedIn](${f.linkedinUrl}))` : "";
      parts.push(`- **${f.name}**${title}${link}`);
    }
  }
  parts.push("");

  parts.push("## Web & funding context");
  if (webContext.length === 0) {
    parts.push("_No supplementary web context found._");
  } else {
    for (const r of webContext) {
      const snippet = r.snippet ? ` — ${r.snippet}` : "";
      parts.push(`- [${r.title}](${r.link})${snippet}`);
    }
  }
  parts.push("");

  return parts.join("\n");
}

/** Render the `people/<slug>.md` deep-dive for a founder/key person. */
export function renderPersonDeepDive(ctx: PersonDeepDiveContext): string {
  const { person: p, company } = ctx;
  const parts: string[] = [];

  parts.push(`# ${p.name}`);
  parts.push("");

  parts.push("## Profile");
  parts.push(line("Relationship", p.relationship));
  parts.push(line("Title", p.title));
  parts.push(line("Company", company?.name));
  parts.push(line("LinkedIn", p.linkedinUrl));
  parts.push(
    line("Connection degree", p.connectionDegree ? `${p.connectionDegree}°` : null),
  );
  parts.push(line("Can refer", p.canRefer ? "yes" : "no"));
  parts.push("");

  parts.push(...renderRichProfile(ctx.raw));

  parts.push("## Outreach");
  parts.push(line("Status", p.outreachStatus));
  parts.push(line("Next action", p.nextAction));
  parts.push(line("Next action date", p.nextActionDate));
  parts.push("");

  return parts.join("\n");
}

/**
 * Render the richer sections (about, experience, education, skills) from the raw
 * LinkedIn profile payload. Defensive: returns nothing for shapes it can't read,
 * so a thin provider (FakeProvider) still produces a valid deep-dive.
 */
function renderRichProfile(raw: unknown): string[] {
  const r = asRecord(raw);
  if (!r) return [];
  const parts: string[] = [];

  const about = asString(r.about) ?? asString(r.summary);
  if (about) {
    parts.push("## About", about, "");
  }

  const experience = asArray(r.experience);
  if (experience.length) {
    parts.push("## Experience");
    for (const e of experience.slice(0, 12)) {
      const er = asRecord(e);
      if (!er) continue;
      const title = asString(er.position) ?? asString(er.title);
      const co = asString(er.companyName) ?? asString(er.company);
      const dates = asString(er.duration) ?? dateRange(er.startDate, er.endDate);
      const head = [title, co].filter(Boolean).join(" — ");
      parts.push(`- ${head || "—"}${dates ? ` (${dates})` : ""}`);
    }
    parts.push("");
  }

  const education = asArray(r.education);
  if (education.length) {
    parts.push("## Education");
    for (const e of education.slice(0, 8)) {
      const er = asRecord(e);
      if (!er) continue;
      const school = asString(er.schoolName) ?? asString(er.school);
      const degree = [asString(er.degree), asString(er.fieldOfStudy)].filter(Boolean).join(", ");
      parts.push(`- ${[school, degree].filter(Boolean).join(" — ") || "—"}`);
    }
    parts.push("");
  }

  const skills = asArray(r.skills)
    .map((s) => asString(s) ?? asString(asRecord(s)?.name))
    .filter((s): s is string => Boolean(s));
  if (skills.length) {
    parts.push("## Skills", skills.slice(0, 20).join(" · "), "");
  }

  return parts;
}

function dateRange(start: unknown, end: unknown): string | undefined {
  const s = asString(asRecord(start)?.text) ?? asString(start);
  const e = asString(asRecord(end)?.text) ?? asString(end);
  if (!s && !e) return undefined;
  return `${s ?? "?"} – ${e ?? "Present"}`;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export type { Employee };
