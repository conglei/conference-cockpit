/**
 * role-relevance — keep only engineering roles, drop the rest (issue #42).
 *
 * find-jobs ingests EVERY open posting a company has, so the list fills with
 * non-engineering roles (Designer, Account Executive, Growth Marketing Lead,
 * Accountant, HR Business Partner, Recruiter, General Counsel…). The user's
 * taste is engineering IC + eng leadership only, so we gate every candidate
 * title through {@link isRelevantRole} before insert/keep.
 *
 * Per explicit user guidance: seniority in titles is unreliable — small/early
 * companies (the targets) post a bare "Software Engineer" for what is really a
 * senior/founding role. So we deliberately DO NOT require a senior title. We
 * filter on FUNCTION ({@link isEngineeringRole}) and only drop titles that are
 * EXPLICITLY junior ({@link isExplicitlyJunior}); a bare "Engineer"/"Senior
 * Engineer" always survives.
 *
 * Pure and DOM/IO-free: just string predicates over a job title, so the filter
 * is trivially testable and reusable from both the find-jobs paths and the
 * prune-roles cleanup CLI.
 */

/**
 * Generous, case-insensitive keep-list of engineering signals. A title matching
 * ANY of these is treated as an engineering role (IC or eng leadership). The
 * patterns are intentionally word-ish (`\b…\b`) for the short tokens that would
 * otherwise collide with unrelated words (`ml`, `ai`, `sre`, `vp`, `cto`…).
 */
const ENGINEERING_SIGNALS: RegExp[] = [
  /\bengineer/i, // engineer, engineering, engineers (e.g. "Product Engineer")
  /\bdeveloper\b/i,
  /\bswe\b/i,
  /\bsde\b/i,
  /\bsoftware\b/i,
  /\bml\b/i,
  /\bmachine learning\b/i,
  /\bai\b/i, // AI engineer/scientist/researcher (paired with eng/sci tokens below)
  /\bresearch (engineer|scientist)\b/i,
  /\bapplied scientist\b/i,
  /\binfrastructure\b/i,
  /\bbackend\b/i,
  /\bfront[ -]?end\b/i,
  /\bfull[ -]?stack\b/i,
  /\bsystems\b/i,
  /\bplatform\b/i,
  /\bmember of technical staff\b/i,
  /\bmts\b/i,
  /\bfounding engineer\b/i,
  /\bdata (engineer|scientist)\b/i,
  /\bdata scientist\b/i,
  /\bsecurity engineer\b/i,
  /\bdevops\b/i,
  /\bsre\b/i,
  /\bsite reliability\b/i,
  /\barchitect\b/i,
  /\bprogrammer\b/i,
  /\brobotics\b/i,
  /\bembedded\b/i,
  /\bfirmware\b/i,
  /\btech(nical)? lead\b/i,
  /\bengineering manager\b/i,
  /\bengineering director\b/i,
  /\bdirector of engineering\b/i,
  /\bvp\b.*\bengineering\b/i,
  /\bhead of engineering\b/i,
  /\bcto\b/i,
];

/**
 * True for engineering IC + eng leadership titles. Generous on purpose: any one
 * engineering signal keeps the title. "Product Engineer" → kept (has `engineer`);
 * "Product Manager"/"Program Manager"/"Designer" have no engineering token → not
 * kept.
 */
export function isEngineeringRole(title: string): boolean {
  return ENGINEERING_SIGNALS.some((re) => re.test(title));
}

/**
 * Junior signals we explicitly drop. Deliberately narrow: only EXPLICIT junior
 * markers, never a bare seniority-less "Engineer". `\bjr\.?\b` matches "Jr"/"Jr."
 * but not "junior"-spelled words it already covers; `co[ -]?op` matches both
 * "co-op" and "coop".
 */
const JUNIOR_SIGNALS: RegExp[] = [
  /\bintern(ship)?\b/i,
  /\bnew grad(uate)?\b/i,
  /\bjunior\b/i,
  /\bjr\.?\b/i,
  /\bco[ -]?op\b/i,
  /\bapprentice\b/i,
  /\bworking student\b/i,
  /\bentry[ -]level\b/i,
  /\buniversity grad(uate)?\b/i,
];

/**
 * True for titles that are EXPLICITLY junior (intern, new grad, junior, co-op,
 * apprentice, working student, entry-level, university grad). Must NOT fire on a
 * bare "Engineer"/"Senior Engineer" — seniority absence is not juniority.
 */
export function isExplicitlyJunior(title: string): boolean {
  return JUNIOR_SIGNALS.some((re) => re.test(title));
}

/**
 * The funnel gate: keep a role iff it is an engineering function AND not an
 * explicitly junior posting. No senior title is required (see module note).
 */
export function isRelevantRole(title: string): boolean {
  return isEngineeringRole(title) && !isExplicitlyJunior(title);
}
