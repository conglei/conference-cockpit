import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Response cache for paid provider calls — store every raw API response keyed by
 * the request, so we never re-pay for a call we already made and a later pass can
 * re-read `api_cache.response` to mine fields we didn't map yet.
 *
 * It is backed by a DEDICATED sqlite file (env `API_CACHE_DB`, default
 * `data/api-cache.db`) — separate from the main/conference DBs so a single cache
 * is shared across both. The cache wraps the HTTP layer of each paid provider:
 * a HIT returns the stored body WITHOUT a network call and WITHOUT recording the
 * cost meter (hits are free); a MISS does the real fetch and, on a 2xx, stores
 * the raw text + status before returning. Non-2xx and errors are never cached.
 *
 * Failure is non-fatal by design: the cache must never crash a run. If the cache
 * file can't be opened it logs ONE warning and degrades to live (get→undefined,
 * set→no-op), and `API_CACHE=off` disables it outright (always live).
 */

const DB_ENV = "API_CACHE_DB";
const DEFAULT_DB = "data/api-cache.db";
const OFF_ENV = "API_CACHE";

/** A cached response body + the HTTP status it was stored under. */
export interface CachedResponse {
  response: string;
  status: number;
}

/** What `set` records alongside the key (provider name + raw request/response). */
export interface CacheEntry {
  provider: string;
  request: string;
  response: string;
  status: number;
}

/**
 * A stable cache key from the request shape: provider + method + URL + body. The
 * URL's query params are sorted so the same logical request keys identically
 * regardless of param order, and the body is JSON-stringified when present.
 */
export function cacheKey(
  provider: string,
  method: string,
  url: string,
  body?: unknown,
): string {
  return `${provider} ${method} ${sortUrlParams(url)} ${body !== undefined ? JSON.stringify(body) : ""}`;
}

/**
 * Read a fetch Response's body as the raw text we cache. A real `Response`
 * always has `text()`; we fall back to stringifying `json()` so the cache layer
 * stays transparent to lightweight `{ json }`-only fetch stubs in tests.
 */
export async function readBody(res: {
  text?: () => Promise<string>;
  json: () => Promise<unknown>;
}): Promise<string> {
  if (typeof res.text === "function") return res.text();
  return JSON.stringify(await res.json());
}

/** Sort a URL's query params for a deterministic key (leaves a bad URL as-is). */
function sortUrlParams(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * SQLite-backed response cache. Constructed with an explicit `dbPath` (tests pass
 * a tmp file or ":memory:" so they never touch `data/api-cache.db`); the module
 * singleton {@link getResponseCache} reads the path from env.
 *
 * When `API_CACHE=off` the cache is a no-op (get→undefined, set→no-op), and if
 * the file can't open it degrades to the same no-op behavior after one warning.
 */
export class ResponseCache {
  private readonly off: boolean;
  private db: Database.Database | undefined;
  /** True once we've given up on the file (open failed) — degrade to live. */
  private disabled = false;

  constructor(opts: { dbPath: string; off?: boolean }) {
    this.off = opts.off ?? false;
    if (this.off) {
      this.disabled = true;
      return;
    }
    try {
      if (opts.dbPath !== ":memory:") mkdirSync(dirname(opts.dbPath), { recursive: true });
      const db = new Database(opts.dbPath);
      db.exec(
        `CREATE TABLE IF NOT EXISTS api_cache(
          key TEXT PRIMARY KEY,
          provider TEXT,
          request TEXT,
          response TEXT,
          status INTEGER,
          created_at INTEGER
        )`,
      );
      this.db = db;
    } catch (cause) {
      // Never crash a run on a cache-file problem: warn once, degrade to live.
      this.disabled = true;
      console.warn(
        `[api-cache] could not open cache at ${opts.dbPath}; running live (no cache). Cause: ${String(cause)}`,
      );
    }
  }

  /** Look up a cached response; undefined when off, degraded, or a miss. */
  get(key: string): CachedResponse | undefined {
    if (this.disabled || !this.db) return undefined;
    try {
      const row = this.db
        .prepare("SELECT response, status FROM api_cache WHERE key = ?")
        .get(key) as { response: string; status: number } | undefined;
      return row ? { response: row.response, status: row.status } : undefined;
    } catch {
      // A read error must never propagate to a caller — degrade to a miss.
      return undefined;
    }
  }

  /** Store a raw response under `key`; no-op when off or degraded. */
  set(key: string, entry: CacheEntry): void {
    if (this.disabled || !this.db) return;
    try {
      this.db
        .prepare(
          `INSERT INTO api_cache(key, provider, request, response, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             provider = excluded.provider,
             request = excluded.request,
             response = excluded.response,
             status = excluded.status,
             created_at = excluded.created_at`,
        )
        .run(key, entry.provider, entry.request, entry.response, entry.status, Date.now());
    } catch {
      // A write error must never propagate to a caller — silently skip caching.
    }
  }
}

/** Read the cache db path from env (default `data/api-cache.db`). */
function dbPathFromEnv(): string {
  return process.env[DB_ENV] || DEFAULT_DB;
}

/** True when the cache is disabled via `API_CACHE=off`. */
function offFromEnv(): boolean {
  return process.env[OFF_ENV] === "off";
}

// Lazily-opened module singleton — one connection shared across all providers in
// a process (tests construct their own ResponseCache with an explicit path).
let _cache: ResponseCache | undefined;

/**
 * The process-wide response cache, opened lazily over the env-configured file. A
 * single connection is reused for the life of the process; providers call this
 * to wrap their HTTP layer.
 */
export function getResponseCache(): ResponseCache {
  if (!_cache) _cache = new ResponseCache({ dbPath: dbPathFromEnv(), off: offFromEnv() });
  return _cache;
}
