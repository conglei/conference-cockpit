import type { CompanyRepo } from "../db/repository";
import type { Company } from "../db/schema";
import { ProviderConfigError, type CompanyResolution, type EnrichmentProvider } from "./types";

export interface ResolveResult {
  company: Company;
  /** True if either domain or linkedin_url was newly populated. */
  resolved: boolean;
  /** Where the identity came from: provider name, "web-search", or "none". */
  via: string;
  /** Non-fatal diagnostics (e.g. a tier that degraded gracefully). */
  notes: string[];
}

export interface ResolveOptions {
  /**
   * Optional second provider used ONLY for the web-search fallback tier
   * (typically a SearchApiProvider). If omitted, the primary provider's own
   * `resolveCompany` is the single tier.
   */
  searchProvider?: EnrichmentProvider;
}

/**
 * Tiered company resolution: populate the canonical `companies.domain` and
 * `companies.linkedin_url` (the dedupe identity, ADR-0001) through the typed
 * data layer.
 *
 * Tiers, in order:
 *   1. Primary provider's `resolveCompany` (HarvestAPI in production).
 *   2. Web-search fallback (SearchAPI Google) for whatever tier 1 left blank.
 *   3. Claude-in-Chrome manual long-tail — OUT of code scope. When both tiers
 *      leave the company unresolved, we stop here and leave the fields null for
 *      a human/Chrome pass. (See PRD "Claude-in-Chrome … manual long-tail".)
 *
 * Each tier degrades gracefully: a ProviderConfigError (missing key / failed
 * call) is captured as a note and the next tier runs, so the pipeline keeps
 * working with whatever is configured (PRD user-story 19).
 *
 * Already-populated identity fields are preserved; we only fill blanks. We also
 * avoid writing a domain/linkedin that already belongs to a *different* company
 * row (would violate the partial-unique identity), recording that as a note.
 */
export async function resolveCompany(
  repo: CompanyRepo,
  companyId: number,
  provider: EnrichmentProvider,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const company = repo.get(companyId);
  if (!company) {
    throw new Error(`resolveCompany: no company with id ${companyId}`);
  }

  const notes: string[] = [];
  let domain = company.domain ?? undefined;
  let linkedinUrl = company.linkedinUrl ?? undefined;
  let via = "none";

  const query = {
    name: company.name,
    websiteUrl: company.websiteUrl ?? undefined,
    domain,
    linkedinUrl,
    hint: company.location ?? undefined,
  };

  // Tier 1 — primary provider.
  if (!domain || !linkedinUrl) {
    const r = await tryResolve(provider, query, notes);
    if (r) {
      if (!domain && r.domain) {
        domain = r.domain;
        via = r.via;
      }
      if (!linkedinUrl && r.linkedinUrl) {
        linkedinUrl = r.linkedinUrl;
        via = r.via;
      }
    }
  }

  // Tier 2 — web-search fallback for anything still blank.
  if ((!domain || !linkedinUrl) && opts.searchProvider) {
    const r = await tryResolve(opts.searchProvider, { ...query, domain, linkedinUrl }, notes);
    if (r) {
      if (!domain && r.domain) {
        domain = r.domain;
        via = "web-search";
      }
      if (!linkedinUrl && r.linkedinUrl) {
        linkedinUrl = r.linkedinUrl;
        via = "web-search";
      }
    }
  }

  // Tier 3 — Claude-in-Chrome manual long-tail is out of code scope. If we get
  // here unresolved, the fields stay null for a human/Chrome pass.

  // Guard the canonical-identity uniqueness before writing.
  const safe = dropConflicting(repo, companyId, { domain, linkedinUrl }, notes);

  const changed =
    (safe.domain && safe.domain !== company.domain) ||
    (safe.linkedinUrl && safe.linkedinUrl !== company.linkedinUrl);

  if (!changed) {
    return { company, resolved: false, via, notes };
  }

  const updated = repo.update(companyId, {
    domain: safe.domain ?? company.domain,
    linkedinUrl: safe.linkedinUrl ?? company.linkedinUrl,
  });

  return { company: updated ?? company, resolved: true, via, notes };
}

async function tryResolve(
  provider: EnrichmentProvider,
  query: Parameters<EnrichmentProvider["resolveCompany"]>[0],
  notes: string[],
): Promise<CompanyResolution | undefined> {
  try {
    return await provider.resolveCompany(query);
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      notes.push(`[${provider.name}] ${err.message}`);
      return undefined;
    }
    notes.push(`[${provider.name}] unexpected error: ${String(err)}`);
    return undefined;
  }
}

/**
 * Don't write a domain/linkedin that already belongs to a *different* company
 * (the partial-unique identity would reject the update). Drop the conflicting
 * field and leave a note instead of throwing.
 */
function dropConflicting(
  repo: CompanyRepo,
  selfId: number,
  candidate: { domain?: string; linkedinUrl?: string },
  notes: string[],
): { domain?: string; linkedinUrl?: string } {
  const out = { ...candidate };
  if (out.domain) {
    const other = repo.findByIdentity({ domain: out.domain });
    if (other && other.id !== selfId) {
      notes.push(
        `domain "${out.domain}" already belongs to company #${other.id} (${other.name}); not writing it.`,
      );
      out.domain = undefined;
    }
  }
  if (out.linkedinUrl) {
    const other = repo.findByIdentity({ linkedinUrl: out.linkedinUrl });
    if (other && other.id !== selfId) {
      notes.push(
        `linkedin "${out.linkedinUrl}" already belongs to company #${other.id} (${other.name}); not writing it.`,
      );
      out.linkedinUrl = undefined;
    }
  }
  return out;
}
