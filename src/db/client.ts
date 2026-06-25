import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export const DB_URL = process.env.DATABASE_URL ?? "data/conference.db";

/**
 * Create a Drizzle client over a better-sqlite3 database.
 * Pass ":memory:" for an ephemeral DB (used by tests).
 */
export function createDb(url: string = DB_URL) {
  if (url !== ":memory:") {
    mkdirSync(dirname(url), { recursive: true });
  }
  const sqlite = new Database(url);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type DB = ReturnType<typeof createDb>;

// Lazy singleton for the app/CLIs (tests create their own isolated DBs).
let _db: DB | undefined;
export function getDb(): DB {
  if (!_db) _db = createDb();
  return _db;
}
