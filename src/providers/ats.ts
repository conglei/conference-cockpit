/**
 * ATS job-source — pull a company's open roles straight from its public Applicant
 * Tracking System board (issue #40). For the ~214 companies whose
 * `recruiting_website` is an Ashby/Greenhouse/Lever/Workable board, the ATS's own
 * unauthenticated JSON endpoint is free, complete, and uncapped — strictly better
 * than the (paid, 25-capped) HarvestAPI LinkedIn path. Verified live: Ashby
 * gigaml → 43 jobs, Greenhouse newlimit → 11, Lever collate → 16, all 200/no-key.
 *
 * This module is provider-agnostic plumbing, NOT an `EnrichmentProvider`: the
 * board token is already on the company row (`recruiting_website`), so there is
 * no key, no resolution, and no cost metering. It exposes two pure-ish functions:
 *   - detectAts        — parse {provider, token} from a recruiting_website URL.
 *   - fetchAtsJobs     — call the board's public API, normalize to JobSearchResult[].
 *
 * Everything is DEFENSIVE: a non-200, a network error, or an unexpected shape
 * yields `[]` rather than throwing, so the caller can cleanly fall back to the
 * LinkedIn/companyId backend.
 */
import type { JobSearchResult } from "./types";

/** Which ATS a board URL belongs to, and the board token (slug) to query it by. */
export interface AtsBoard {
  provider: "ashby" | "greenhouse" | "lever" | "workable";
  token: string;
}

/**
 * Parse the ATS provider + board token out of a `recruiting_website` URL.
 *
 *   ashby      jobs.ashbyhq.com/<token>                         → first path seg
 *   greenhouse boards.greenhouse.io/<token>                     → first path seg
 *              job-boards.greenhouse.io/<token>                 (both host forms)
 *   lever      jobs.lever.co/<token>                            → first path seg
 *   workable   <token>.workable.com                            → subdomain
 *
 * Returns `undefined` for anything that isn't a recognized public board (e.g. an
 * on-domain `acme.com/careers` page) — the caller treats that as "no ATS, fall
 * back to LinkedIn."
 */
export function detectAts(recruitingWebsite: string): AtsBoard | undefined {
  let url: URL;
  try {
    url = new URL(recruitingWebsite);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  // First non-empty path segment (path-token providers address the board there).
  // Decode it: an aggregator may link `…/Resolve%20AI/…`, but the board token is
  // the literal "Resolve AI" — fetchAts re-encodes once, so storing the decoded
  // form avoids the double-encoding that yielded 0 jobs.
  const rawSeg = url.pathname.split("/").filter(Boolean)[0];
  const firstSeg = rawSeg ? decodeURIComponent(rawSeg) : rawSeg;

  if (host === "jobs.ashbyhq.com") {
    return firstSeg ? { provider: "ashby", token: firstSeg } : undefined;
  }
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    return firstSeg ? { provider: "greenhouse", token: firstSeg } : undefined;
  }
  if (host === "jobs.lever.co") {
    return firstSeg ? { provider: "lever", token: firstSeg } : undefined;
  }
  if (host.endsWith(".workable.com")) {
    // Subdomain is the token; ignore the bare apex / an `apply.workable.com` chrome host.
    const sub = host.slice(0, -".workable.com".length);
    return sub && sub !== "apply" && sub !== "www"
      ? { provider: "workable", token: sub }
      : undefined;
  }

  return undefined;
}

/**
 * Build the canonical public board URL for a detected board — the inverse of
 * {@link detectAts}. Used by discovery to persist a `recruiting_website` (so the
 * existing fetch/insert path can run) and to probe a candidate {provider, token}.
 */
export function boardToUrl(board: AtsBoard): string {
  switch (board.provider) {
    case "ashby":
      return `https://jobs.ashbyhq.com/${board.token}`;
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${board.token}`;
    case "lever":
      return `https://jobs.lever.co/${board.token}`;
    case "workable":
      return `https://${board.token}.workable.com`;
  }
}

/**
 * Probe candidate board tokens against each ATS provider and return the first
 * {board, url, jobCount} that yields ≥1 job — discovery for a company whose
 * board isn't already known. Free, no key; defensive (never throws).
 */
export async function probeAtsBoard(
  tokens: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ board: AtsBoard; url: string; jobCount: number } | undefined> {
  const providers: AtsBoard["provider"][] = ["ashby", "greenhouse", "lever"];
  for (const token of tokens) {
    if (!token || token.length < 2) continue;
    for (const provider of providers) {
      const url = boardToUrl({ provider, token });
      const jobs = await fetchAtsJobs(url, fetchImpl);
      if (jobs.length > 0) return { board: { provider, token }, url, jobCount: jobs.length };
    }
  }
  return undefined;
}

/**
 * Fetch a company's open roles from its public ATS board and normalize each
 * posting to the existing {@link JobSearchResult} shape. `companyName` is left
 * empty on purpose — the caller already knows the company and links by id.
 *
 * Field mappings (verified live against each ATS's free public endpoint):
 *   - Ashby      GET /posting-api/job-board/<token>            → { jobs: [...] }
 *   - Greenhouse GET /v1/boards/<token>/jobs?content=true      → { jobs: [...] }
 *   - Lever      GET /v0/postings/<token>?mode=json            → [ ... ] (bare array)
 *   - Workable   GET /spi/v3/jobs                              → best-effort, may be []
 *
 * DEFENSIVE by contract: detection miss, non-200, network error, or unexpected
 * shape all return `[]`. This function NEVER throws.
 */
export async function fetchAtsJobs(
  recruitingWebsite: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JobSearchResult[]> {
  const board = detectAts(recruitingWebsite);
  if (!board) return [];

  switch (board.provider) {
    case "ashby":
      return fetchAshby(board.token, fetchImpl);
    case "greenhouse":
      return fetchGreenhouse(board.token, fetchImpl);
    case "lever":
      return fetchLever(board.token, fetchImpl);
    case "workable":
      return fetchWorkable(board.token, fetchImpl);
  }
}

// --- per-provider adapters ---

async function fetchAshby(token: string, fetchImpl: typeof fetch): Promise<JobSearchResult[]> {
  const data = await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
    fetchImpl,
  );
  return rows(data, "jobs").map((j) => ({
    title: str(j.title),
    companyName: "",
    location: optStr(j.location),
    link: optStr(j.jobUrl) ?? optStr(j.applyUrl),
    externalId: idStr(j.id),
    postedDate: optStr(j.publishedAt),
    description: optStr(j.descriptionPlain) ?? optStr(j.descriptionHtml),
  }));
}

async function fetchGreenhouse(token: string, fetchImpl: typeof fetch): Promise<JobSearchResult[]> {
  const data = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
    fetchImpl,
  );
  return rows(data, "jobs").map((j) => ({
    title: str(j.title),
    companyName: "",
    location: optStr(record(j.location)?.name),
    link: optStr(j.absolute_url),
    externalId: idStr(j.id),
    postedDate: optStr(j.updated_at),
    description: optStr(j.content),
  }));
}

async function fetchLever(token: string, fetchImpl: typeof fetch): Promise<JobSearchResult[]> {
  const data = await getJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
    fetchImpl,
  );
  // Lever returns a bare array of postings (no wrapper key).
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return list.map((j) => {
    const cats = record(j.categories);
    return {
      title: str(j.text),
      companyName: "",
      location: optStr(cats?.location),
      link: optStr(j.hostedUrl) ?? optStr(j.applyUrl),
      externalId: idStr(j.id),
      // Lever's createdAt is a millisecond epoch; normalize to an ISO string.
      postedDate: epochMsToIso(j.createdAt),
      description: optStr(j.descriptionPlain),
    };
  });
}

/**
 * Workable (only ~2 companies — best-effort). Its public board API is less
 * uniform than the others; if the response isn't a clean `{ jobs: [...] }` list
 * we return `[]` and let the caller fall back to LinkedIn rather than guessing.
 */
async function fetchWorkable(token: string, fetchImpl: typeof fetch): Promise<JobSearchResult[]> {
  const data = await getJson(
    `https://${encodeURIComponent(token)}.workable.com/spi/v3/jobs`,
    fetchImpl,
  );
  return rows(data, "jobs").map((j) => ({
    title: str(j.title),
    companyName: "",
    location: optStr(workableLocation(j)),
    link: optStr(j.url) ?? optStr(j.application_url) ?? optStr(j.shortlink),
    externalId: idStr(j.id) ?? idStr(j.shortcode),
    postedDate: optStr(j.published_on) ?? optStr(j.created_at),
    description: optStr(j.description),
  }));
}

// --- defensive fetch + parse helpers (NEVER throw) ---

/** GET a JSON endpoint with no key; any failure (network, non-200, bad JSON) → undefined. */
async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** Pull `data[key]` as an array of objects, tolerating any non-conforming shape. */
function rows(data: unknown, key: string): Record<string, unknown>[] {
  const obj = record(data);
  const arr = obj?.[key];
  if (!Array.isArray(arr)) return [];
  return arr.filter((el): el is Record<string, unknown> => !!el && typeof el === "object");
}

/** Narrow an unknown to a plain object, else undefined. */
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** A required string field; missing/non-string collapses to "". */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** An optional string field; non-strings (and empty strings) become undefined. */
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Stringify a job id (Ashby strings, Greenhouse/Lever numbers) for `external_id`. */
function idStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Lever-style ms epoch → ISO 8601; non-numbers (or 0) yield undefined. */
function epochMsToIso(v: unknown): string | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return new Date(v).toISOString();
}

/** Workable nests location under `location` (city/country) — flatten best-effort. */
function workableLocation(j: Record<string, unknown>): string | undefined {
  const loc = record(j.location);
  if (!loc) return optStr(j.location);
  const parts = [optStr(loc.city), optStr(loc.region), optStr(loc.country)].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}
