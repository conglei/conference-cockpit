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
import type { EnrichmentProvider, JobSearchResult } from "../providers/types";

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const hyphen = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// --- board identity guard (issue: token-collision false matches) ---------
//
// Probe and (especially) web-search can surface a board that ISN'T the company's:
// searching `"Daytona" careers lever.co` returned `jobs.lever.co/insomniacookies`
// (a bakery with a Daytona Beach store) → 1,477 retail roles wrongly attributed.
// So every DISCOVERED board must prove it identifies as the company before we
// trust it: its token (or, for Greenhouse, its org display name) has to overlap
// the company's name / slug / domain. Trusted exact sources (an existing board
// URL the aggregator already linked) skip this — they're the company's own data.

/** Common corporate suffixes to strip so "togetherai" ↔ "together" still match. */
const SUFFIX = /(ai|inc|labs?|hq|io|app|co|technologies|technology|systems)$/;

/** Identity keys a board must overlap to count as this company's board. */
function companyKeys(input: { name: string; slug: string; domain?: string | null }): string[] {
  const raw = [input.name, input.slug, input.domain ? input.domain.split(".")[0] : ""]
    .map(alnum)
    .filter((k) => k.length >= 2);
  const keys = new Set(raw);
  for (const k of raw) {
    const stripped = k.replace(SUFFIX, "");
    if (stripped.length >= 3) keys.add(stripped);
  }
  return [...keys];
}

/** True if `candidate` (a board token or org name) plausibly belongs to the company. */
export function identityMatches(candidate: string, keys: string[]): boolean {
  const c = alnum(candidate);
  if (c.length < 2) return false;
  const cs = c.replace(SUFFIX, "");
  for (const k of keys) {
    if (c === k || cs === k) return true;
    if (c.includes(k) || k.includes(c)) return true; // one contains the other
    const n = Math.min(c.length, k.length); // or a shared prefix of ≥4 chars
    if (n >= 4 && c.slice(0, n) === k.slice(0, n)) return true;
  }
  return false;
}

/** Greenhouse exposes the org display name at the board root; others don't (cheaply). */
async function fetchBoardOrgName(
  board: AtsBoard,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  if (board.provider !== "greenhouse") return undefined;
  try {
    const res = await fetchImpl(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { name?: unknown };
    return typeof data.name === "string" ? data.name : undefined;
  } catch {
    return undefined;
  }
}

/** Does a discovered board prove it's this company's? Token match, else org-name match. */
async function verifyBoardIdentity(
  board: AtsBoard,
  keys: string[],
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (identityMatches(board.token, keys)) return true;
  const org = await fetchBoardOrgName(board, fetchImpl);
  return org ? identityMatches(org, keys) : false;
}

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
  /** The live jobs fetched while verifying the board — reuse to avoid re-fetching. */
  jobs: JobSearchResult[];
}

/**
 * A web-search board candidate for the AGENT to judge (ADR-0002: the CLI gathers
 * the evidence; a Claude session decides which link is really the company's). The
 * heuristic `identity` verdict pre-sorts the obvious from the ambiguous so the
 * agent only has to adjudicate the genuinely unclear ones.
 */
export interface BoardCandidate {
  url: string;
  board: AtsBoard;
  /** Greenhouse org display name when available — the strongest identity signal. */
  orgName?: string;
  jobCount: number;
  /** A few titles so the agent can sanity-check the board is the right line of work. */
  sampleTitles: string[];
  /** Cheap structural verdict: does token/org overlap the company name? */
  identity: "match" | "weak";
}

/**
 * Gather every recognizable ATS board the web search surfaces for a company,
 * each annotated with the evidence an agent needs to judge it (org name, live
 * job count, sample titles, heuristic verdict). Does NOT decide — that's the
 * agent's job. Returns [] if no search provider or no recognizable hit.
 */
export async function gatherBoardCandidates(
  input: DiscoverInput,
  deps: DiscoverDeps = {},
): Promise<BoardCandidate[]> {
  if (!deps.searchProvider) return [];
  const fetchImpl = deps.fetchImpl ?? fetch;
  const keys = companyKeys(input);
  const q = `"${input.name}" careers jobs (ashbyhq.com OR greenhouse.io OR lever.co OR workable.com)`;

  let results: unknown[];
  try {
    results = await deps.searchProvider.search({ q, engine: "web" });
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const candidates: BoardCandidate[] = [];
  for (const r of results) {
    const link = (r as { link?: string }).link;
    if (!link) continue;
    const board = detectAts(link);
    if (!board) continue;
    const dedupe = `${board.provider}:${board.token}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const jobs = await fetchAtsJobs(boardToUrl(board), fetchImpl);
    if (jobs.length === 0) continue; // a dead/empty board is not a candidate
    const orgName = await fetchBoardOrgName(board, fetchImpl);
    const tokenOk = identityMatches(board.token, keys);
    const orgOk = orgName ? identityMatches(orgName, keys) : false;
    candidates.push({
      url: boardToUrl(board),
      board,
      orgName,
      jobCount: jobs.length,
      sampleTitles: jobs.slice(0, 6).map((j) => j.title).filter(Boolean),
      identity: tokenOk || orgOk ? "match" : "weak",
    });
  }
  return candidates;
}

export async function discoverAtsBoardUrl(
  input: DiscoverInput,
  deps: DiscoverDeps = {},
): Promise<DiscoveredBoard | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const keys = companyKeys(input);

  // 1. Existing role URLs — the aggregator's own link for THIS company (trusted,
  //    no identity check). Verify the board is LIVE so a dead/mis-encoded token
  //    falls through to the probe rather than sticking the company on 0 jobs.
  for (const url of input.roleUrls ?? []) {
    const board = detectAts(url);
    if (!board) continue;
    const jobs = await fetchAtsJobs(boardToUrl(board), fetchImpl);
    if (jobs.length > 0) return { url: boardToUrl(board), board, via: "role-url", jobs };
  }

  // 2. recruiting_website — exact, free, trusted; same liveness gate.
  if (input.recruitingWebsite) {
    const board = detectAts(input.recruitingWebsite);
    if (board) {
      const jobs = await fetchAtsJobs(boardToUrl(board), fetchImpl);
      if (jobs.length > 0) return { url: boardToUrl(board), board, via: "recruiting_website", jobs };
    }
  }

  // 3. Probe ATS endpoints with token candidates — free. Tokens are derived from
  //    the company, but a slug can collide with another org's board, so verify.
  const probed = await probeAtsBoard(
    tokenCandidates({ name: input.name, domain: input.domain, slug: input.slug }),
    fetchImpl,
  );
  if (probed && (await verifyBoardIdentity(probed.board, keys, fetchImpl))) {
    const jobs = await fetchAtsJobs(probed.url, fetchImpl);
    if (jobs.length > 0) return { url: probed.url, board: probed.board, via: "probe", jobs };
  }

  // 4. Web search — UNTRUSTED (it found Insomnia Cookies for "Daytona"). When an
  //    agent judge isn't wired in, fall back to the cheap heuristic: the single
  //    identity-matching candidate, else the highest-volume match. Ambiguity is
  //    meant to be escalated via gatherBoardCandidates(), not guessed here.
  if (deps.searchProvider) {
    const candidates = await gatherBoardCandidates(input, deps);
    const matches = candidates.filter((c) => c.identity === "match");
    const pick =
      matches.length === 1
        ? matches[0]
        : matches.length > 1
          ? [...matches].sort((a, b) => b.jobCount - a.jobCount)[0]
          : undefined;
    if (pick) {
      const jobs = await fetchAtsJobs(pick.url, fetchImpl);
      if (jobs.length > 0) return { url: pick.url, board: pick.board, via: "web-search", jobs };
    }
  }

  return undefined;
}
