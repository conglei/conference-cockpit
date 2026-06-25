import type { Company } from "../db/schema";
import type { EnrichmentProvider, WebSearchResult } from "../providers/types";
import { isCompanyNameAsPerson, isPlausiblePersonName } from "./person-name";

/** A founder candidate recovered from web search. */
export interface WebSearchFounder {
  name: string;
  title?: string;
}

/** Max candidates we return — conservative, precision over recall (ADR-0003 §2). */
const MAX_CANDIDATES = 4;

/**
 * A founder/exec cue (the role word) immediately preceding OR following a
 * Capitalized Full Name, e.g. "co-founder Jane Doe" / "Jane Doe, CEO". We bind
 * the cue and the name in one regex so a stray capitalized phrase with no role
 * word nearby is ignored — that conservatism is the whole point of this rung.
 */
// The cue is matched case-insensitively (titles vary: "CEO", "Ceo", "ceo"); the
// candidate name span is matched loosely here and then re-validated with a
// strict, case-SENSITIVE check ({@link STRICT_NAME}) before acceptance — the `i`
// flag would otherwise let `[A-Z]` match lowercase and admit junk like
// "founded by".
const CUE = "(?:co-?founders?|founders?|ceo|cto|chief[a-z ]*officer|chief)";
const NAME = "[A-Za-z]+(?:\\s+[A-Za-z]\\.?)?\\s+[A-Za-z]+";
const CUE_THEN_NAME = new RegExp(`\\b${CUE}\\b[\\s,:'"|–—-]{1,6}(${NAME})`, "gi");
const NAME_THEN_CUE = new RegExp(`\\b(${NAME})\\b[\\s,:'"|–—()-]{1,6}(?:the\\s+)?${CUE}\\b`, "gi");

/** Accept only a genuinely Capitalized Full Name (case-sensitive, anchored). */
const STRICT_NAME = /^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$/;

/** Map the matched cue back to a normalized title for the row. */
function titleForCue(text: string, name: string): string | undefined {
  const idx = text.indexOf(name);
  const window = text.slice(Math.max(0, idx - 24), idx + name.length + 24).toLowerCase();
  if (/co-?founder/.test(window)) return "Co-founder";
  if (/\bfounder/.test(window)) return "Founder";
  if (/\bceo\b/.test(window)) return "CEO";
  if (/\bcto\b/.test(window)) return "CTO";
  if (/chief/.test(window)) return "Chief";
  return undefined;
}

/**
 * The WEB-SEARCH rung of the founder recovery ladder (ADR-0003 §2, issue #10).
 *
 * TRIGGERED, not always-on: the caller invokes this only when the normal roster
 * comes back with zero founders. We run 1-2 conservative web searches and parse
 * founder NAMES from result titles/snippets, requiring a founder/exec cue
 * adjacent to a Capitalized Full Name. Precision over recall — a result with no
 * clear name+cue pairing yields nothing. Dedupes by name and caps at
 * {@link MAX_CANDIDATES}. Pushes a `notes` entry describing what it recovered;
 * on any error it pushes a note and returns `[]` (never throws).
 */
export async function webSearchFounders(
  searchProvider: EnrichmentProvider,
  company: Company,
  notes: string[],
): Promise<WebSearchFounder[]> {
  const queries = [
    `${company.name} founders`,
    `${company.name} CEO co-founder`,
  ];

  const found = new Map<string, WebSearchFounder>(); // key: lower-cased name

  try {
    for (const q of queries) {
      if (found.size >= MAX_CANDIDATES) break;
      const results = await searchProvider.search({ q, engine: "web", limit: 5 });
      const web = results.filter((r): r is WebSearchResult => "link" in r);
      for (const r of web) {
        const text = `${r.title} ${r.snippet ?? ""}`;
        for (const name of extractFounderNames(text)) {
          const key = name.toLowerCase();
          if (found.has(key)) continue;
          found.set(key, { name, title: titleForCue(text, name) });
          if (found.size >= MAX_CANDIDATES) break;
        }
        if (found.size >= MAX_CANDIDATES) break;
      }
    }
  } catch (err) {
    notes.push(`[${searchProvider.name}] web-search founder recovery failed: ${String(err)}`);
    return [];
  }

  // Tighten the over-admitting fallback (issue #28): drop the company name
  // parsed as a person, and anything that is not a plausible human name.
  // Precision over recall — this is a last-resort rung.
  const candidates = [...found.values()];
  const out: WebSearchFounder[] = [];
  let dropped = 0;
  for (const f of candidates) {
    if (isCompanyNameAsPerson(f.name, company.name) || !isPlausiblePersonName(f.name)) {
      dropped++;
      continue;
    }
    out.push(f);
  }
  if (dropped > 0) {
    notes.push(
      `web-search founder recovery dropped ${dropped} candidate(s) as noise ` +
        `(company-name-as-person or non-person name).`,
    );
  }

  if (out.length > 0) {
    notes.push(
      `web-search founder recovery (roster was empty) found ${out.length} candidate(s): ` +
        out.map((f) => f.name).join(", "),
    );
  } else {
    notes.push(
      `web-search founder recovery (roster was empty) found no confident founder names ` +
        `for "${company.name}".`,
    );
  }
  return out;
}

/**
 * Extract Capitalized Full Names that sit adjacent to a founder/exec cue in a
 * single block of text. Conservative: a name must pair with a cue (before or
 * after) to be returned; bare capitalized phrases are ignored.
 */
function extractFounderNames(text: string): string[] {
  const names = new Set<string>();
  for (const re of [CUE_THEN_NAME, NAME_THEN_CUE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1]?.trim();
      if (name && STRICT_NAME.test(name)) names.add(name);
    }
  }
  return [...names];
}
