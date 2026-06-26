import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export const DB_URL = process.env.DATABASE_URL ?? "data/conference.db";

/** libsql needs a URL scheme. Map bare paths → file:, pass schemes through. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (/^(file|libsql|https?|wss?):/.test(url)) return url;
  mkdirSync(dirname(url), { recursive: true }); // local file path
  return `file:${url}`;
}

export function createDb(url: string = DB_URL) {
  const client = createClient({
    url: toLibsqlUrl(url),
    authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}
export type DB = ReturnType<typeof createDb>;

// libsql has no read-only connection flag; the query CLI's safety now rests on
// the query module being write-free (see ADR-0005). Optionally a read-only Turso
// token enforces it in the cloud. Alias for now.
export function createReadOnlyDb(url: string = DB_URL) {
  return createDb(url);
}

// Lazy singleton for the app/CLIs (tests create their own isolated DBs).
let _db: DB | undefined;
export function getDb(): DB {
  if (!_db) _db = createDb();
  return _db;
}
