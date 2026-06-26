import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

/**
 * Resolve the DB URL from the environment, READ AT CALL TIME. This must be lazy:
 * CLIs call `loadEnvFile()` *after* importing this module, so `process.env.DATABASE_URL`
 * is not yet populated at import time. An eager `const DB_URL = process.env…` froze
 * to the local fallback and made every CLI silently ignore a configured Turso URL.
 */
export function resolveDbUrl(): string {
  return process.env.DATABASE_URL ?? "data/conference.db";
}

/** libsql needs a URL scheme. Map bare paths → file:, pass schemes through. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (/^(file|libsql|https?|wss?):/.test(url)) return url;
  mkdirSync(dirname(url), { recursive: true }); // local file path
  return `file:${url}`;
}

export function createDb(url: string = resolveDbUrl()) {
  const client = createClient({
    url: toLibsqlUrl(url),
    authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}
export type DB = ReturnType<typeof createDb>;

/**
 * The mutating entry points on the Drizzle handle. The agent's query path
 * (`src/query`) only ever reads (`.select()` / `.query`), so blocking these at
 * the seam makes a read-only handle that *cannot* drive a write — restoring the
 * ADR-0005 invariant the libSQL migration dropped (libSQL has no connection-level
 * read-only flag, unlike better-sqlite3's `{ readonly: true }`).
 */
const WRITE_METHODS = new Set(["insert", "update", "delete", "run", "batch", "transaction"]);

/**
 * A read-only DB handle for exploration (the `query` CLI, ADR-0005). Reads pass
 * through to a normal connection; any write method throws. This is enforcement at
 * the application seam, not the transport — in the cloud, pair it with a
 * read-only Turso token (`turso db tokens create --read-only`) for a second line.
 */
export function createReadOnlyDb(url: string = resolveDbUrl()): DB {
  const db = createDb(url);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => {
          throw new Error(`read-only DB: '${prop}' is blocked (ADR-0005)`);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DB;
}

// Lazy singleton for the app/CLIs (tests create their own isolated DBs).
let _db: DB | undefined;
export function getDb(): DB {
  if (!_db) _db = createDb();
  return _db;
}
