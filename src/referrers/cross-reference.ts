/**
 * Cross-reference a target company's employee roster against the user's
 * 1st-degree connections to flag warm-intro paths (issue 06).
 *
 * For a company with a canonical LinkedIn URL we pull its roster
 * (`provider.getEmployees`) and check each employee against the people already
 * ingested as 1st-degree contacts. A match means: *this person you already know
 * works at this target company* — a warm referrer. We persist that by setting
 * `connection_degree` and `can_refer = true` on the matched `people` row and
 * linking it to the company.
 *
 * Deterministic primitive (ADR-0002): the only matching is exact identity
 * (LinkedIn URL, else normalized name). Fuzzy/judgment matching of ambiguous
 * names is the SKILL's job — it can pre-confirm and hand clean matches here.
 * The provider is injected so tests run offline against `FakeProvider`.
 */

import type { CompanyRepo } from "../db/repository";
import type { PersonRepo } from "../db/people-repository";
import type { Company, Person } from "../db/schema";
import type { EnrichmentProvider } from "../providers/types";

export interface CrossReferenceOptions {
  /** Cap the roster size pulled from the provider. */
  limit?: number;
}

export interface CrossReferenceResult {
  company: Company;
  /** Size of the roster the provider returned. */
  rosterSize: number;
  /** Matched contacts now flagged as referrers (after persistence). */
  referrers: Person[];
}

/**
 * Cross-reference one company's roster against the user's connections, flagging
 * matched contacts as referrers. Returns the freshly-updated person rows.
 */
export async function crossReferenceCompany(
  companyRepo: CompanyRepo,
  personRepo: PersonRepo,
  provider: EnrichmentProvider,
  company: Company,
  opts: CrossReferenceOptions = {},
): Promise<CrossReferenceResult> {
  if (!company.linkedinUrl) {
    // No canonical LinkedIn URL → no roster to pull. Not an error: the company
    // simply isn't resolved enough yet (resolve/enrich it first).
    return { company, rosterSize: 0, referrers: [] };
  }

  const roster = await provider.getEmployees({
    companyLinkedinUrl: company.linkedinUrl,
    limit: opts.limit,
  });

  // Index the user's 1st-degree contacts for O(1) lookup by both identities.
  const connections = await personRepo.listConnections();
  const byUrl = new Map<string, Person>();
  const byName = new Map<string, Person>();
  for (const c of connections) {
    if (c.linkedinUrl) byUrl.set(c.linkedinUrl, c);
    byName.set(normalizeName(c.name), c);
  }

  const referrers: Person[] = [];
  const seen = new Set<number>();
  for (const emp of roster) {
    const match =
      (emp.linkedinUrl ? byUrl.get(emp.linkedinUrl) : undefined) ??
      byName.get(normalizeName(emp.name));
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);

    const updated = await personRepo.update(match.id, {
      companyId: company.id,
      canRefer: true,
      // A 1st-degree contact who works at the target is a 1st-degree path in.
      connectionDegree: match.connectionDegree ?? 1,
      // Backfill the title the roster gives us if we didn't have one.
      title: match.title ?? emp.title ?? null,
    });
    if (updated) referrers.push(updated);
  }

  return { company, rosterSize: roster.length, referrers };
}

/** Normalize a display name for tolerant exact matching (case/space-insensitive). */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
