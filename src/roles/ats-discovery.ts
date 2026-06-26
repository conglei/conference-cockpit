/**
 * Discover a company's public ATS board (Ashby/Greenhouse/Lever/Workable) so its
 * live openings can be pulled directly (free, complete, current) instead of from
 * a stale aggregator. Cascade, cheapest-first:
 *
 *   1. extract from the company's EXISTING role URLs (the aggregator already
 *      linked the board — `jobs.ashbyhq.com/<token>/…` — so `detectAts` reads it)
 *   2. extract from `recruiting_website` if set
 *   3. PROBE the ATS endpoints with token candidates (name/domain slug) — free
 *   4. WEB SEARCH (SearchAPI) for the board URL, verified by a live fetch — paid
 *
 * Returns the canonical board URL (to persist as `recruiting_website`, after
 * which the existing `findJobsFromAts` fetch+insert path runs) or undefined.
 */
import { detectAts, boardToUrl, probeAtsBoard, fetchAtsJobs, type AtsBoard } from "../providers/ats";
import type { EnrichmentProvider } from "../providers/types";

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const hyphen = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Token candidates an ATS board is likely keyed by: name + domain base, alnum + hyphenated. */
export function tokenCandidates(opts: { name?: string; domain?: string | null; slug?: string }): string[] {
  const bases = [opts.slug, opts.name, opts.domain ? opts.domain.split(".")[0] : undefined].filter(
    (b): b is string => Boolean(b),
  );
  const out = new Set<string>();
  for (const b of bases) {
    out.add(alnum(b));
    out.add(hyphen(b));
  }
  return [...out].filter((t) => t.length >= 2);
}

export interface DiscoverInput {
  name: string;
  slug: string;
  domain?: string | null;
  recruitingWebsite?: string | null;
  /** The company's existing role URLs (the aggregator's links) to extract from. */
  roleUrls?: string[];
}

export interface DiscoverDeps {
  /** Provider for the web-search tier (SearchAPI). Omit to skip tier 4. */
  searchProvider?: EnrichmentProvider;
  fetchImpl?: typeof fetch;
}

export interface DiscoveredBoard {
  url: string;
  board: AtsBoard;
  via: "role-url" | "recruiting_website" | "probe" | "web-search";
}

export async function discoverAtsBoardUrl(
  input: DiscoverInput,
  deps: DiscoverDeps = {},
): Promise<DiscoveredBoard | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  // 1. Existing role URLs — exact, free, no network.
  for (const url of input.roleUrls ?? []) {
    const board = detectAts(url);
    if (board) return { url: boardToUrl(board), board, via: "role-url" };
  }

  // 2. recruiting_website — exact, free.
  if (input.recruitingWebsite) {
    const board = detectAts(input.recruitingWebsite);
    if (board) return { url: boardToUrl(board), board, via: "recruiting_website" };
  }

  // 3. Probe ATS endpoints with token candidates — free.
  const probed = await probeAtsBoard(
    tokenCandidates({ name: input.name, domain: input.domain, slug: input.slug }),
    fetchImpl,
  );
  if (probed) return { url: probed.url, board: probed.board, via: "probe" };

  // 4. Web search for the board URL — paid; verify the hit actually has jobs.
  if (deps.searchProvider) {
    const q = `"${input.name}" careers jobs (ashbyhq.com OR greenhouse.io OR lever.co OR workable.com)`;
    try {
      const results = await deps.searchProvider.search({ q, engine: "web" });
      for (const r of results) {
        const link = (r as { link?: string }).link;
        if (!link) continue;
        const board = detectAts(link);
        if (!board) continue;
        const jobs = await fetchAtsJobs(boardToUrl(board), fetchImpl);
        if (jobs.length > 0) return { url: boardToUrl(board), board, via: "web-search" };
      }
    } catch {
      /* search unavailable → skip tier 4 */
    }
  }

  return undefined;
}
