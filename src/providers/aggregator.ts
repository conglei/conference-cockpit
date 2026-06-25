import pRetry, { AbortError, type Options as RetryOptions } from "p-retry";

/**
 * Aggregator-domain crawler (ADR-0003 §1).
 *
 * Source feeds like startups.gallery list a company *aggregator page* but not a
 * clean domain. That page (a Framer SPA) does, however, embed the company's real
 * website in its HTML. This module turns an aggregator URL into the company's
 * real { domain, websiteUrl } so the domain-first resolver can anchor identity on
 * a domain instead of guessing by name.
 *
 * The aggregator URL is a TRANSIENT input — we derive and persist the domain/
 * website, never the aggregator URL itself.
 *
 * Method (validated on the worst real failures — recovers paradigmai.com,
 * sdsa.ai, 0.email): fetch the RAW HTML (a markdown-converting fetcher drops the
 * SPA content), collect external links, drop known non-company hosts, and
 * frequency-rank — the company's own domain appears many times (header, footer,
 * CTAs) and wins decisively over one-off embeds.
 */

/** Host substrings that are never the company's own domain. */
const DENY_HOST = [
  // the aggregator + its framework / CDNs / fonts
  "startups.gallery", "framer.com", "framerusercontent.com", "framer.app",
  "vercel", "cloudflare", "gstatic", "googleapis", "googletagmanager",
  "google.com", "google-analytics", "fonts.", "schema.org", "w3.org",
  // social
  "linkedin.", "twitter.", "x.com", "youtube.", "youtu.be", "github.",
  "facebook.", "instagram.", "tiktok.", "discord.", "t.me", "medium.com",
  // news / funding press
  "techcrunch.", "bloomberg.", "finsmes.", "crunchbase.", "businesswire.",
  "prnewswire.", "forbes.", "reuters.", "axios.", "theinformation.",
  // careers / forms / scheduling
  "ashbyhq.", "greenhouse.io", "lever.co", "workable.", "tally.so",
  "typeform.", "calendly.", "notion.so", "notion.site", "docsend.",
  // generic
  "gravatar.", "wp.com", "gstatic.",
];

const HOST_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;

/**
 * Full-URL scan (scheme + host + path) for careers-link detection. The domain
 * extractor only needs bare hosts (HOST_RE); recruiting detection needs the path
 * too (e.g. `acme.com/careers`), so it gets its own pass over the HTML.
 */
const URL_RE = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>)]*)?/gi;

/**
 * Known applicant-tracking / job-board hosts: a link to any of these IS the
 * company's careers link, full URL and all. Substring-matched against the host.
 */
const ATS_HOST = [
  "jobs.ashbyhq.com", "ashbyhq.com",
  "boards.greenhouse.io", "job-boards.greenhouse.io", "greenhouse.io",
  "jobs.lever.co", "lever.co",
  ".workable.com", "wellfound.com", "bamboohr.com", "rippling.com", "gem.com",
];

/**
 * Is `url` a careers/recruiting link? Either a known ATS host, or a careers/jobs
 * subdomain or path on any non-denied host (`careers.`/`jobs.` host, or a
 * `/careers`/`/jobs` path). Aggregator/framework/social hosts are excluded so we
 * never mistake e.g. a LinkedIn jobs link for the company's own board.
 */
function isRecruitingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (ATS_HOST.some((h) => host.includes(h))) return true;
  if (isDenied(host)) return false;
  const path = parsed.pathname.toLowerCase();
  return host.startsWith("careers.") || host.startsWith("jobs.") || /\/careers|\/jobs/.test(path);
}

/** First careers/recruiting URL in document order, or undefined when none. */
function recruitingFromHtml(html: string): string | undefined {
  for (const m of html.matchAll(URL_RE)) {
    if (isRecruitingUrl(m[0])) return m[0];
  }
  return undefined;
}

/** Registrable-ish host: strip a leading `www.`, lower-case. */
function apex(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function isDenied(host: string): boolean {
  const h = host.toLowerCase();
  return DENY_HOST.some((d) => h.includes(d));
}

export interface CrawledDomain {
  /** Apex company domain, e.g. "paradigmai.com". */
  domain: string;
  /** Canonical https website URL for that domain. */
  websiteUrl: string;
  /**
   * The company's careers/recruiting link (ATS board or careers.* / /careers
   * page) when the page embeds one — additive to the domain result; undefined
   * when no careers link is found.
   */
  recruitingUrl?: string;
}

/** Default backoff: a few quick retries — overridable (tests use ~1ms timeouts). */
const DEFAULT_RETRY: RetryOptions = { retries: 3, factor: 2, minTimeout: 200, maxTimeout: 5_000 };

/**
 * Crawl an aggregator page and return the company's real domain + website, or
 * `undefined` when nothing clears the bar. `fetchImpl` is injectable for tests.
 *
 * Transient fetch failures (network error, 429 rate-limit, 5xx) are retried with
 * backoff — in a real recovery run, 111 of 116 'unresolved' companies were
 * throttled/blocked fetches whose pages actually had content (ADR-0003 §1). A
 * clean non-OK 4xx (e.g. 404) and a 200 page with no extractable company domain
 * are TERMINAL: those are genuine misses, not transient, so we don't waste
 * retries. The contract is unchanged — returns `{ domain, websiteUrl }` or
 * `undefined` after retries are exhausted. `opts.retry` tunes the backoff.
 */
export async function crawlCompanyDomain(
  aggregatorUrl: string,
  fetchImpl: typeof fetch = fetch,
  opts: { retry?: RetryOptions } = {},
): Promise<CrawledDomain | undefined> {
  const retry = { ...DEFAULT_RETRY, ...opts.retry };
  try {
    return await pRetry(async () => {
      let res: Response;
      try {
        res = await fetchImpl(aggregatorUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; conference-cockpit/1.0)" },
        });
      } catch (cause) {
        // Network-level failure — transient, let p-retry back off and retry.
        throw new Error(`crawlCompanyDomain fetch failed (network error): ${String(cause)}`);
      }
      // 429 / 5xx are transient (throttling, blocking, server hiccups) → retry.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`crawlCompanyDomain got ${res.status} ${res.statusText} (retrying)`);
      }
      // Any other non-OK (clean 4xx like 404) is terminal — the page isn't there.
      if (!res.ok) throw new AbortError(`crawlCompanyDomain got ${res.status} ${res.statusText}`);
      // A 200 page that simply has no company domain is a real 'unresolved', not
      // transient — abort so we don't burn retries re-fetching the same content.
      const result = domainFromHtml(await res.text());
      if (!result) throw new AbortError("no company domain in page");
      return result;
    }, retry);
  } catch {
    // Retries exhausted, or a terminal AbortError — preserve the undefined contract.
    return undefined;
  }
}

/**
 * A company's own domain is referenced repeatedly (header, footer, CTAs), so it
 * must clear this frequency to win. Below it, the only candidates are one-off
 * embeds/noise — return undefined and let the company fall to the recovery
 * ladder rather than pick a wrong domain (validated real domains appear 6–7×).
 */
const MIN_CONFIDENCE = 2;

/** Pure extraction step (separately testable): HTML → company domain. */
export function domainFromHtml(html: string): CrawledDomain | undefined {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(HOST_RE)) {
    const host = apex(m[1]);
    if (!host || isDenied(host)) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  // Highest-frequency external host is the company's own domain — if it clears
  // the confidence bar.
  let best = "";
  let bestN = 0;
  for (const [host, n] of counts) {
    if (n > bestN) {
      best = host;
      bestN = n;
    }
  }
  if (!best || bestN < MIN_CONFIDENCE) return undefined;
  // Additive: scan the same HTML for a careers/recruiting link (ATS board or a
  // careers.* / /careers page). Leaves the domain result unchanged when absent.
  return { domain: best, websiteUrl: `https://${best}`, recruitingUrl: recruitingFromHtml(html) };
}
