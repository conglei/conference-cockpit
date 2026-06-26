import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, DB_URL, type DB } from "../db/client";

/**
 * Ensure the SQLite database exists and is fully migrated.
 *
 * This reuses the exact migrate path from `scripts/migrate.ts` (the Drizzle
 * libsql migrator against the `drizzle/` folder) — no raw SQL is
 * duplicated here. Drizzle's migrator records applied migrations in its
 * `__drizzle_migrations` table, so calling this when the DB already exists is
 * a no-op: it is safe and idempotent to run on every onboarding.
 *
 * Pass a `url` (e.g. ":memory:" or a temp path) for tests; defaults to the
 * configured DB_URL.
 */
export async function ensureDb(url: string = DB_URL, db?: DB): Promise<DB> {
  const handle = db ?? createDb(url);
  await migrate(handle, { migrationsFolder: "drizzle" });
  return handle;
}
