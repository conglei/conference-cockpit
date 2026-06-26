/**
 * People facts for taste-ranking, split into two layers:
 *
 *   1. **Generic fact extractors** (taste-neutral, reusable by ANY persona) —
 *      raw past employers, an education summary, and "is this person a founder".
 *      These surface *facts*; they make no judgment about what's "good".
 *   2. **The Career Mover pedigree heuristic** (`founderPedigree`) — ONE persona's
 *      taste (a "founder bar" prizing top-lab / big-tech / research pedigree).
 *      This is NOT universal: it's the default Career Mover lens used by
 *      `who-to-meet`. Other personas (recruiter, investor, learner) judge
 *      differently and should read the raw facts above, not this.
 *
 * Pure string logic over plain fields — no DB, fully unit-testable.
 */

/** First needle that appears in the haystack (lower-cased substring), if any. */
export function has(hay: string | null | undefined, needles: string[]): string | undefined {
  if (!hay) return undefined;
  const h = hay.toLowerCase();
  return needles.find((n) => h.includes(n));
}

/** Parsed work_history entries (lower-cased company + end label) — for matching. */
export function workEntries(workHistory: string | null): Array<{ company: string; end: string }> {
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

// ===================== Generic fact extractors (taste-neutral) =====================

/**
 * PAST employer names (original case) — excludes the current company and any
 * still-current ("Present") role. A FACT, not a judgment: the caller decides
 * whether "ex-OpenAI" matters for their taste.
 */
export function pastEmployers(workHistory: string | null, currentName: string): string[] {
  if (!workHistory) return [];
  const cur = (currentName ?? "").toLowerCase();
  try {
    const arr = JSON.parse(workHistory) as Array<{ company?: string; end?: string }>;
    return arr
      .map((e) => ({ c: (e.company ?? "").trim(), end: (e.end ?? "").toLowerCase() }))
      .filter(
        (e) =>
          e.c &&
          e.end !== "present" &&
          !(cur && (e.c.toLowerCase().includes(cur) || cur.includes(e.c.toLowerCase()))),
      )
      .map((e) => e.c);
  } catch {
    return [];
  }
}

/** A compact, human-readable education summary (degree — field — school). FACT. */
export function educationSummary(education: string | null): string | null {
  if (!education) return null;
  try {
    const arr = JSON.parse(education) as Array<{ school?: string; degree?: string; field?: string }>;
    const parts = arr
      .map((e) => [e.degree, e.field, e.school].filter(Boolean).join(" — "))
      .filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  } catch {
    return education.slice(0, 140);
  }
}

/** Is this person a founder/exec of their company (by title or headline)? FACT. */
const FOUNDER_EXEC = ["founder", "co-founder", "cofounder", "ceo", "cto", "chief"];
export function isFounderTitle(title: string | null | undefined, headline?: string | null): boolean {
  return Boolean(has(title, FOUNDER_EXEC) || has(headline, FOUNDER_EXEC));
}

// ============== Career Mover pedigree heuristic (ONE persona's taste) ==============
// The "founder bar": prizes PAST top-lab / big-tech employers + a research
// background. This encodes the Career Mover lens specifically; it is not a
// universal ranking rule. Used by `who-to-meet`.

const TOP_LABS = ["openai", "deepmind", "google brain", "fair", "meta ai", "anthropic"];
const BIG_TECH = [
  "google", "meta", "facebook", "amazon", "aws", "microsoft", "apple", "nvidia",
  "stripe", "airbnb", "uber", "netflix", "databricks", "salesforce", "tesla", "linkedin",
];
const RESEARCH = ["phd", "ph.d", "doctor of philosophy"];
const RESEARCH_TITLE = ["professor", "research scientist", "phd", "faculty"];

/** PAST employers as a single lower-cased string (for the Career Mover bar match). */
function pastCompaniesLower(workHistory: string | null, currentName: string): string {
  const cur = currentName.toLowerCase();
  return workEntries(workHistory)
    .filter((e) => e.end !== "present" && !(cur && (e.company.includes(cur) || cur.includes(e.company))))
    .map((e) => e.company)
    .join(" | ");
}

export interface Pedigree {
  topLab?: string;
  bigTech?: string;
  research: boolean;
  founderExec: boolean;
  /** Display flags, strongest first: e.g. ["ex-OpenAI", "PhD/research", "founder/exec"]. */
  flags: string[];
}

export interface PedigreeInput {
  workHistory: string | null;
  education: string | null;
  headline: string | null;
  currentName: string;
}

/** The Career Mover "founder bar" signal for one person (one persona's taste). */
export function founderPedigree(input: PedigreeInput): Pedigree {
  const past = pastCompaniesLower(input.workHistory, input.currentName);
  const lab = has(past, TOP_LABS);
  const big = !lab ? has(past, BIG_TECH) : undefined;
  const research = !!(has(input.education, RESEARCH) || has(input.headline, RESEARCH_TITLE));
  const founderExec = !!(has(input.headline, FOUNDER_EXEC) || has(input.workHistory, FOUNDER_EXEC));

  const topLab = lab ? prettyOrg(lab) : undefined;
  const bigTech = big ? prettyOrg(big) : undefined;
  const flags: string[] = [];
  if (topLab) flags.push(`ex-${topLab}`);
  else if (bigTech) flags.push(`ex-${bigTech}`);
  if (research) flags.push("PhD/research");
  if (founderExec) flags.push("founder/exec");

  return { topLab, bigTech, research, founderExec, flags };
}

/** Proper-cased labels for pedigree orgs (acronyms/camelCase done right). */
const ORG_LABELS: Record<string, string> = {
  openai: "OpenAI", deepmind: "DeepMind", "google brain": "Google Brain", fair: "FAIR",
  "meta ai": "Meta AI", anthropic: "Anthropic", google: "Google", meta: "Meta",
  facebook: "Meta", amazon: "Amazon", aws: "AWS", microsoft: "Microsoft", apple: "Apple",
  nvidia: "Nvidia", stripe: "Stripe", airbnb: "Airbnb", uber: "Uber", netflix: "Netflix",
  databricks: "Databricks", salesforce: "Salesforce", tesla: "Tesla", linkedin: "LinkedIn",
};
const prettyOrg = (token: string): string => ORG_LABELS[token] ?? titleCase(token);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
function titleCase(s: string): string {
  return s.split(" ").map((w) => (w === "ai" ? "AI" : cap(w))).join(" ");
}
