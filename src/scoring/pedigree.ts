/**
 * The **founder bar** primitive: derive prestige/pedigree signal from a person's
 * work history + education. This is the shared core of taste-ranking — both the
 * people ranker (`who-to-meet`) and the company scoring-context use it, so the
 * vocabulary and the "PAST employers only" rule live in exactly one place.
 *
 * Pure string logic over plain fields — no DB, fully unit-testable.
 */

/** Top AI labs — the strongest pedigree signal (substring match, lower-cased). */
export const TOP_LABS = ["openai", "deepmind", "google brain", "fair", "meta ai", "anthropic"];
/** Big-tech / prestige operators (substring match, lower-cased). */
export const BIG_TECH = [
  "google", "meta", "facebook", "amazon", "aws", "microsoft", "apple", "nvidia",
  "stripe", "airbnb", "uber", "netflix", "databricks", "salesforce", "tesla", "linkedin",
];
const RESEARCH = ["phd", "ph.d", "doctor of philosophy"];
const RESEARCH_TITLE = ["professor", "research scientist", "phd", "faculty"];
const FOUNDER_EXEC = ["founder", "co-founder", "cofounder", "ceo", "cto", "chief"];

/** First needle that appears in the haystack (lower-cased substring), if any. */
export function has(hay: string | null | undefined, needles: string[]): string | undefined {
  if (!hay) return undefined;
  const h = hay.toLowerCase();
  return needles.find((n) => h.includes(n));
}

/** Parsed work_history entries (lower-cased company + end label). */
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

/**
 * PAST employers only — excludes the current company and any still-current role
 * ("Present"). "ex-OpenAI" must never fire for someone *currently* at OpenAI.
 */
export function pastCompanies(workHistory: string | null, currentName: string): string {
  const cur = currentName.toLowerCase();
  return workEntries(workHistory)
    .filter((e) => e.end !== "present" && !(cur && (e.company.includes(cur) || cur.includes(e.company))))
    .map((e) => e.company)
    .join(" | ");
}

/** The founder-bar signal for one person, structured + as display flags. */
export interface Pedigree {
  /** Proper-cased ex-top-lab org (e.g. "OpenAI"), if any. */
  topLab?: string;
  /** Proper-cased ex-big-tech org, if any (only when not a top lab). */
  bigTech?: string;
  research: boolean;
  founderExec: boolean;
  /** Display flags, strongest first: e.g. ["ex-OpenAI", "PhD/research", "founder/exec"]. */
  flags: string[];
}

export interface PedigreeInput {
  workHistory: string | null;
  education: string | null;
  /** LinkedIn headline (or title) — carries research-title + founder/exec signal. */
  headline: string | null;
  /** The person's CURRENT company name, so past-only excludes it. */
  currentName: string;
}

/** Derive the founder-bar pedigree (the dominant axis of the Career Mover taste). */
export function founderPedigree(input: PedigreeInput): Pedigree {
  const past = pastCompanies(input.workHistory, input.currentName);
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

/** Does this pedigree clear the founder bar — a top-lab/big-tech operator OR a serious researcher? */
export function clearsFounderBar(p: Pedigree): boolean {
  return Boolean(p.topLab || p.bigTech || p.research);
}

/** Is this person a founder/exec of their company (by title or headline)? */
export function isFounderTitle(title: string | null | undefined, headline?: string | null): boolean {
  return Boolean(has(title, FOUNDER_EXEC) || has(headline, FOUNDER_EXEC));
}

/** Proper-cased labels for pedigree orgs (acronyms/camelCase done right). */
const ORG_LABELS: Record<string, string> = {
  openai: "OpenAI", deepmind: "DeepMind", "google brain": "Google Brain", fair: "FAIR",
  "meta ai": "Meta AI", anthropic: "Anthropic", google: "Google", meta: "Meta",
  facebook: "Meta", amazon: "Amazon", aws: "AWS", microsoft: "Microsoft", apple: "Apple",
  nvidia: "Nvidia", stripe: "Stripe", airbnb: "Airbnb", uber: "Uber", netflix: "Netflix",
  databricks: "Databricks", salesforce: "Salesforce", tesla: "Tesla", linkedin: "LinkedIn",
};
export const prettyOrg = (token: string): string => ORG_LABELS[token] ?? titleCase(token);

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w === "ai" ? "AI" : cap(w)))
    .join(" ");
}
