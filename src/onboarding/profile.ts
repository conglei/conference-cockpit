import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Profile document machinery for onboarding.
 *
 * Markdown is canonical for identity & narrative (PRD "Data architecture"):
 *   - profile/resume.md      — the user's résumé (ingested, not retyped)
 *   - profile/preferences.md — taste/weights, later read by the scorer
 *   - profile/narrative.md   — story / what they're optimizing for
 *
 * Everything here is deterministic and testable. The conversational interview
 * is conducted by the `onboard` skill (see .claude/skills/onboard/SKILL.md); this
 * module provides the durable write/scaffold logic the skill drives.
 */

export const PROFILE_DIR = "profile";
export const RESUME_PATH = join(PROFILE_DIR, "resume.md");
export const PREFERENCES_PATH = join(PROFILE_DIR, "preferences.md");
export const NARRATIVE_PATH = join(PROFILE_DIR, "narrative.md");

function ensureParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Resolve a profile-relative path under an optional base dir (for tests). */
function resolve(baseDir: string | undefined, relPath: string): string {
  return baseDir ? join(baseDir, relPath) : relPath;
}

export interface IngestResumeOptions {
  /** Base directory to write under (defaults to cwd). Used by tests. */
  baseDir?: string;
}

/**
 * Ingest a résumé into profile/resume.md.
 *
 * Accepts the résumé as a raw string (e.g. pasted / piped via stdin) and writes
 * it verbatim. If the input already looks like markdown it is kept as-is;
 * otherwise plain text is preserved (markdown renders plain text fine).
 *
 * PDF/DOCX rendering is OUT of scope (PRD): callers pass already-extracted
 * text. The companion `ingestResumeFromPath` reads a text/markdown file.
 *
 * Returns the absolute-or-relative path written.
 */
export function ingestResume(
  resumeText: string,
  opts: IngestResumeOptions = {},
): string {
  const target = resolve(opts.baseDir, RESUME_PATH);
  ensureParent(target);
  const body = normalizeResume(resumeText);
  writeFileSync(target, body, "utf8");
  return target;
}

/**
 * Ingest a résumé from a file path (must be text or markdown). Throws a clear
 * error for binary formats we don't render.
 */
export function ingestResumeFromPath(
  sourcePath: string,
  opts: IngestResumeOptions = {},
): string {
  if (/\.(pdf|docx?|rtf|pages)$/i.test(sourcePath)) {
    throw new Error(
      `Cannot ingest "${sourcePath}": binary résumé formats (PDF/DOCX) are out of scope. ` +
        `Paste the text or pass a .txt/.md file.`,
    );
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Résumé file not found: ${sourcePath}`);
  }
  const text = readFileSync(sourcePath, "utf8");
  return ingestResume(text, opts);
}

/** Trim trailing whitespace and ensure a single trailing newline. */
function normalizeResume(text: string): string {
  const trimmed = text.replace(/\s+$/g, "");
  return trimmed.length > 0 ? `${trimmed}\n` : "";
}

export interface ScaffoldOptions {
  baseDir?: string;
  /** Overwrite an existing file. Default false (won't clobber real content). */
  force?: boolean;
}

/**
 * Write the preferences.md starter template the interview fills in.
 *
 * The defaults encode the PRD taste: founder_quality and investor_quality are
 * co-dominant (highest weight). These weights are plain-language and later read
 * by the scorer.
 *
 * Returns { path, created } where created=false means an existing file was kept.
 */
export function scaffoldPreferences(opts: ScaffoldOptions = {}): {
  path: string;
  created: boolean;
} {
  const target = resolve(opts.baseDir, PREFERENCES_PATH);
  if (!opts.force && existsSync(target)) return { path: target, created: false };
  ensureParent(target);
  writeFileSync(target, PREFERENCES_TEMPLATE, "utf8");
  return { path: target, created: true };
}

/**
 * Write the narrative.md starter template the interview fills in.
 */
export function scaffoldNarrative(opts: ScaffoldOptions = {}): {
  path: string;
  created: boolean;
} {
  const target = resolve(opts.baseDir, NARRATIVE_PATH);
  if (!opts.force && existsSync(target)) return { path: target, created: false };
  ensureParent(target);
  writeFileSync(target, NARRATIVE_TEMPLATE, "utf8");
  return { path: target, created: true };
}

/**
 * Write any profile docs that don't yet exist (resume placeholder excluded —
 * the résumé is ingested, not templated). Idempotent.
 */
export function scaffoldProfileDocs(opts: ScaffoldOptions = {}): {
  preferences: { path: string; created: boolean };
  narrative: { path: string; created: boolean };
} {
  return {
    preferences: scaffoldPreferences(opts),
    narrative: scaffoldNarrative(opts),
  };
}

export const PREFERENCES_TEMPLATE = `# Preferences

> Taste & scoring weights. Written in plain language — the scorer reads this file
> (alongside narrative.md) to rank companies. Edit freely; you don't need to touch
> code to tune your taste. The \`onboard\` skill interviews you and fills this in.

## What I'm optimizing for

<!-- One or two sentences: the bet you're making with this search. -->
I am building my network and making relationship bets on companies with
high-reputation, senior founders — either an established-but-not-too-big lab
(application side, building vertical AI systems) or a small, well-funded startup
with solid founders. Founder seniority and investor quality matter more to me
than raw company velocity.

## Scoring weights

Co-dominant (highest weight — these drive the ranking):

- **founder_quality** — seniority, reputation, and track record of the founders.
- **investor_quality** — quality of the lead investor / cap table.

Secondary axes:

- **domain_fit** — how well what they build matches my interests (general AI,
  agents, data — not single-modality or already-scaled).
- **stage_fit** — preferred company stage (early-stage; pre-seed → Series A).
- **size_fit** — company size band ("not too big": small startup or app-side of
  an established lab, not a scaled org).

> Default stance: **founder_quality and investor_quality are co-dominant**; the
> secondary axes break ties. Adjust the emphasis below in plain language.

### Emphasis (edit me)

<!-- e.g. "Weight founder_quality slightly above investor_quality." -->
- founder_quality: high
- investor_quality: high
- domain_fit: medium
- stage_fit: medium
- size_fit: medium

## Hard pre-filter criteria

> The deterministic pre-filter drops rows that fail these before any LLM scoring.

- **Stage:** <!-- e.g. pre-seed, seed, Series A; exclude later stages -->
- **Location / work type:** <!-- e.g. SF Bay Area; onsite/hybrid OK -->
- **Category:** <!-- e.g. AI / agents / data infra; exclude X -->
- **Company size band:** <!-- e.g. < 200 people -->

## Deal-breakers

<!-- Anything that's an automatic pass. -->
-

## Nice-to-haves

<!-- Soft positives that nudge the score up. -->
-
`;

export const NARRATIVE_TEMPLATE = `# Narrative

> My story and what I'm optimizing for. Read in full by outreach drafting and the
> taste-scorer to ground tailored messages and explain why a company surfaced.
> The \`onboard\` skill interviews you and fills this in.

## Who I am

<!-- The short version: current role, what you build, how you describe yourself. -->

## What I've built

<!-- 2–4 highlights that show range and depth. Specific > generic. -->
-

## What I'm looking for next

<!-- The role/company you're aiming at and why now. -->

## What I'm optimizing for

<!-- The deeper goal beneath the job title — the bet you're making. -->

## How I want to come across

<!-- Tone/register for outreach: founder cold-note vs. warm referral ask. -->

## What I bring to a small team

<!-- Why a senior founder would want you early. -->
`;
