/**
 * Read **scoring weights** and **hard pre-filter criteria** from
 * `profile/preferences.md`, where they live in plain language so the user can
 * tune taste without touching code (PRD user-story 26).
 *
 * ADR-0002: parsing a *known, structured* section of our own file is a
 * deterministic primitive — not the open-ended "adapt to arbitrary input"
 * judgment that belongs to a skill. The parser is deliberately **lenient**:
 * it reads qualitative emphasis words (`high`/`medium`/`low`, or numbers) and
 * falls back to a sane default (founder/investor co-dominant) for anything it
 * can't read. It never throws on a malformed file.
 */
import { readFileSync } from "node:fs";
import type { SubScores } from "./scorer";
import type { PrefilterCriteria } from "./prefilter";

/** Relative weight per sub-score (need not sum to 1; `combineOverall` normalizes). */
export type ScoreWeights = Record<keyof SubScores, number>;

/**
 * Default weights: `founder_quality` and `investor_quality` co-dominant (highest,
 * equal), the three secondary axes lower and equal. This is the PRD's default
 * stance and the fallback when `preferences.md` is missing/unreadable.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  founder_quality: 3,
  investor_quality: 3,
  domain_fit: 1,
  stage_fit: 1,
  size_fit: 1,
};

/** Map a qualitative emphasis word to a numeric weight. */
const EMPHASIS: Record<string, number> = {
  "co-dominant": 3,
  dominant: 3,
  highest: 3,
  high: 3,
  "very high": 3,
  medium: 1,
  med: 1,
  moderate: 1,
  secondary: 1,
  low: 0.5,
  minor: 0.5,
  ignore: 0,
  none: 0,
};

const AXES: (keyof SubScores)[] = [
  "founder_quality",
  "investor_quality",
  "domain_fit",
  "stage_fit",
  "size_fit",
];

/**
 * Parse weights from preferences.md text. Recognizes lines like:
 *   - founder_quality: high
 *   - investor_quality: 3
 *   - **domain_fit** — medium
 * Anything unspecified keeps its DEFAULT_WEIGHTS value, so a partial file is fine.
 */
export function parseWeights(text: string): ScoreWeights {
  const out: ScoreWeights = { ...DEFAULT_WEIGHTS };
  if (!text) return out;

  const lines = text.split(/\r?\n/);
  for (const axis of AXES) {
    // Match the axis name (underscores OR spaces) followed by : / — / - and a value.
    const namePattern = axis.replace(/_/g, "[ _]");
    const re = new RegExp(`${namePattern}\\s*[\\*]*\\s*[:\\-—–]\\s*(.+)`, "i");
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const v = parseValue(m[1]);
      if (v !== undefined) {
        out[axis] = v;
        break; // first hit wins
      }
    }
  }
  return out;
}

function parseValue(raw: string): number | undefined {
  const s = raw.trim().toLowerCase().replace(/[.*_`]+$/g, "").trim();
  // numeric first
  const num = s.match(/^-?\d+(\.\d+)?/);
  if (num) {
    const n = Number(num[0]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  // qualitative emphasis (longest matching key wins, e.g. "very high")
  const key = Object.keys(EMPHASIS)
    .sort((a, b) => b.length - a.length)
    .find((k) => s.startsWith(k) || s.includes(` ${k}`) || s === k);
  if (key) return EMPHASIS[key];
  return undefined;
}

/**
 * The co-dominant axes (ADR-0003 §3): the highest-weighted, decision-driving
 * pair. Missing coverage on these is what triggers the confidence discount.
 */
const CO_DOMINANT_AXES: (keyof SubScores)[] = ["founder_quality", "investor_quality"];

/**
 * Combine sub-scores into an overall 0–1 score (ADR-0003 §3). Missing data is
 * first-class:
 *
 *   1. **Renormalize over present axes.** A `null` sub-score is *unknown*, not 0;
 *      the weighted average is taken over only the non-null axes, renormalized by
 *      their weights — so a missing axis neither helps nor hurts on its own.
 *   2. **Discount for missing co-dominant coverage.** founder_quality and
 *      investor_quality are co-dominant; a company we can't actually evaluate
 *      must not outrank a fully-vetted one. Let
 *      `coverage = presentCoDominantWeight / totalCoDominantWeight`, then
 *      `overall *= 0.6 + 0.4 * coverage` — both missing → ×0.6, one missing →
 *      ×0.8, both present → ×1.0.
 *
 * Result is clamped to [0,1]. Weights need not sum to 1.
 */
export function combineOverall(sub: SubScores, weights: ScoreWeights): number {
  // 1. Weighted average over the PRESENT (non-null) axes only.
  let wSum = 0;
  let acc = 0;
  for (const axis of AXES) {
    const v = sub[axis];
    if (v === null || v === undefined) continue; // missing data — skip, don't fabricate a 0
    const w = Math.max(0, weights[axis] ?? 0);
    wSum += w;
    acc += w * clamp01(v);
  }
  if (wSum === 0) return 0; // nothing present (or all-zero weights) → 0
  const base = acc / wSum;

  // 2. Confidence discount for missing co-dominant coverage.
  let totalCoDominant = 0;
  let presentCoDominant = 0;
  for (const axis of CO_DOMINANT_AXES) {
    const w = Math.max(0, weights[axis] ?? 0);
    totalCoDominant += w;
    if (sub[axis] !== null && sub[axis] !== undefined) presentCoDominant += w;
  }
  const coverage = totalCoDominant === 0 ? 1 : presentCoDominant / totalCoDominant;
  const overall = base * (0.6 + 0.4 * coverage);

  return Math.round(clamp01(overall) * 1000) / 1000;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Parse the "Hard pre-filter criteria" section into `PrefilterCriteria`.
 * Reads the four bullet lines (Stage / Location-work type / Category / Company
 * size band) plus deal-breakers. Tolerates the scaffold's HTML-comment
 * placeholders by treating an empty value as "no constraint". Comma/slash/`or`
 * separated values become token lists.
 */
export function parsePrefilter(text: string): PrefilterCriteria {
  const criteria: PrefilterCriteria = {};
  if (!text) return criteria;

  const stage = findCriterion(text, ["stage"]);
  if (stage.length) criteria.stages = stage;

  const loc = findCriterion(text, ["location", "location / work type", "location/work type"]);
  // Location lines often mix a place and a work type; split work-type tokens out.
  const { workTypes, rest } = splitWorkTypes(loc);
  if (rest.length) criteria.locations = rest;
  if (workTypes.length) criteria.workTypes = workTypes;

  const cat = findCriterion(text, ["category"]);
  if (cat.length) criteria.categories = cat;

  const size = findCriterion(text, ["company size band", "size band", "company size"]);
  if (size.length) criteria.sizeBands = size;

  const deal = findCriterion(text, ["deal-breakers", "deal breakers", "dealbreakers"]);
  if (deal.length) criteria.excludeKeywords = deal;

  return criteria;
}

const WORK_TYPE_TOKENS = ["onsite", "remote", "hybrid"];

function splitWorkTypes(tokens: string[]): { workTypes: string[]; rest: string[] } {
  const workTypes: string[] = [];
  const rest: string[] = [];
  for (const t of tokens) {
    const low = t.toLowerCase();
    const wt = WORK_TYPE_TOKENS.find((w) => low === w || low.startsWith(w));
    if (wt) workTypes.push(wt);
    else rest.push(t);
  }
  return { workTypes: dedupe(workTypes), rest: dedupe(rest) };
}

/**
 * Find a labelled bullet/line and return its value split into tokens. Looks for
 * `**Label:**`, `Label:`, or `- Label —` forms. Returns [] when missing, empty,
 * or only an HTML-comment placeholder.
 */
function findCriterion(text: string, labels: string[]): string[] {
  const lines = text.split(/\r?\n/);
  for (const label of labels) {
    const pattern = label.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\s+/g, "\\s*[/]?\\s*");
    const re = new RegExp(`${pattern}\\s*[\\*]*\\s*[:\\-—–]\\s*(.*)`, "i");
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const tokens = tokenizeValue(m[1]);
      if (tokens.length) return tokens;
    }
  }
  return [];
}

/** Strip HTML comments / markdown noise, split on , / "or", lower-case, dedupe. */
function tokenizeValue(raw: string): string[] {
  let s = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/[*`]/g, "").trim();
  // drop a leading "e.g." and trailing punctuation
  s = s.replace(/^e\.?g\.?:?\s*/i, "").replace(/[.;]+$/, "").trim();
  if (!s) return [];
  return dedupe(
    s
      .split(/\s*(?:,|\/|\bor\b|;)\s*/i)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && !/^exclude\b/.test(t)),
  );
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

// --- File helpers (thin; default path matches the onboard scaffold) ---

export const PREFERENCES_PATH = "profile/preferences.md";

export interface ParsedPreferences {
  weights: ScoreWeights;
  prefilter: PrefilterCriteria;
  /** Raw text (handed to the scorer skill verbatim). */
  text: string;
}

/** Read + parse preferences.md; missing/unreadable file → defaults, no throw. */
export function loadPreferences(path: string = PREFERENCES_PATH): ParsedPreferences {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  return { weights: parseWeights(text), prefilter: parsePrefilter(text), text };
}
