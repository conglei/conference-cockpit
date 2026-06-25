/**
 * Name-quality predicates shared across the founder-recovery ladder.
 *
 * Two callers, two appetites for precision:
 *  - The WEB-SEARCH recovery rung (`founder-web-search.ts`) is a last-resort,
 *    over-admitting fallback, so it uses the STRICT {@link isPlausiblePersonName}
 *    (exactly 2-3 Capitalized tokens) — see ADR-0003 §2 / issue #28.
 *  - The ROSTER persist path (`enrich-company.ts`) is higher-precision input
 *    (Apollo/HarvestAPI), where legitimate founders may have mononyms or
 *    non-Western names; it uses the lighter {@link looksLikeOrgNoise}, which only
 *    drops the OBVIOUS junk (org/role strings) rather than imposing the strict
 *    capitalization rule — see issue #32.
 */

/**
 * Generic corporate suffixes that turn a company name into an org-shaped string
 * (e.g. "Arcade Software", "Giga Co"). Used to recognize a candidate that is
 * really the company name, not a person.
 */
export const CORP_SUFFIXES = [
  "software",
  "labs",
  "lab",
  "inc",
  "llc",
  "co",
  "ai",
  "hq",
  "technologies",
  "systems",
];

/**
 * Org/role tokens that, when present in a candidate "name", mark it as noise
 * rather than a human name (e.g. "Sequoia Capital", "Acme Labs", "Information
 * Security"). Conservative and deliberately small — every token here must be a
 * word that essentially never appears as a real surname/given name.
 */
export const ORG_TOKENS = new Set([
  "software",
  "inc",
  "labs",
  "capital",
  "ventures",
  "partners",
  "information",
  "intelligence",
  "security",
  "systems",
  "solutions",
  "technologies",
]);

/**
 * Role/title words that describe a position, not a person. A "name" made up
 * entirely of these (e.g. "Co Founder", "Chief Information", "CEO") is a role
 * phrase the provider mis-rostered, never a human. Kept small and lowercase.
 */
const ROLE_WORDS = new Set([
  "founder",
  "founders",
  "cofounder",
  "co",
  "ceo",
  "cto",
  "coo",
  "cfo",
  "cmo",
  "chief",
  "officer",
  "president",
  "vp",
  "head",
  "lead",
  "director",
  "manager",
  "owner",
  "partner",
  "executive",
]);

/** Lowercase + strip everything that is not a letter or digit. */
export function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True if the candidate name is really the company name (or company name plus a
 * generic corp suffix). E.g. for company "Arcade": "Arcade", "Arcade Software".
 * For company "Giga": "Giga Co".
 */
export function isCompanyNameAsPerson(candidate: string, companyName: string): boolean {
  const c = normalizeForCompare(candidate);
  const company = normalizeForCompare(companyName);
  if (!c || !company) return false;
  if (c === company) return true;
  if (c.startsWith(company)) {
    const rest = c.slice(company.length);
    if (rest === "") return true;
    if (CORP_SUFFIXES.includes(rest)) return true;
  }
  return false;
}

/**
 * True if the string looks like a plausible human name: exactly two or three
 * Capitalized tokens, each alphabetic (a middle initial like "B." is allowed in
 * the 3-token form) and length >= 2 for the real name tokens. Rejects
 * single-token and org-shaped strings, and any token that is a known org word.
 *
 * STRICT — used by the web-search rung only. The roster path uses the lighter
 * {@link looksLikeOrgNoise} so it does not reject legitimate mononyms /
 * non-Western names.
 */
export function isPlausiblePersonName(name: string): boolean {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 3) return false;
  for (const token of tokens) {
    if (ORG_TOKENS.has(token.toLowerCase())) return false;
    // Allow a middle initial ("B." / "B") only as a non-terminal token.
    if (/^[A-Z]\.?$/.test(token)) continue;
    if (!/^[A-Z][a-z]+$/.test(token)) return false;
    if (token.length < 2) return false;
  }
  // First and last token must be full names, not bare initials.
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (/^[A-Z]\.?$/.test(first) || /^[A-Z]\.?$/.test(last)) return false;
  return true;
}

/**
 * LIGHTER, roster-grade guard (issue #32): true only for CLEAR non-persons, so
 * that a higher-precision roster (Apollo/HarvestAPI) keeps legitimate mononyms
 * and non-Western full names while still dropping obvious org/role junk that was
 * persisted as founders (real examples: "Information Security", "Co Founder",
 * "Chief Information").
 *
 * Returns true when ANY of:
 *  - the name IS the company name (or company name + a generic corp suffix);
 *  - any token is in the org-token set (Security, Capital, Ventures, …);
 *  - the name is a pure role/title phrase — EVERY token is a role/title word
 *    (e.g. "Co Founder", "Chief Information", "Founder", "CEO").
 *
 * Deliberately does NOT impose the strict 2-3-capitalized-token rule.
 */
export function looksLikeOrgNoise(name: string, companyName: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;

  if (isCompanyNameAsPerson(trimmed, companyName)) return true;

  const tokens = trimmed.split(/\s+/);

  // Any single org-shaped token (Capital, Ventures, Information, Security, …)
  // marks the whole string as an org, not a person.
  if (tokens.some((t) => ORG_TOKENS.has(t.toLowerCase()))) return true;

  // A pure role/title phrase: every token (ignoring punctuation, e.g. the "-"
  // in "Co-Founder") is a role/title word, so there is no real surname.
  const allRoleWords = tokens.every((t) => {
    const norm = t.toLowerCase().replace(/[^a-z]/g, "");
    return norm === "" || ROLE_WORDS.has(norm);
  });
  if (allRoleWords) return true;

  return false;
}
