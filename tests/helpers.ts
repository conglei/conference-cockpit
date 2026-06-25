import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, type DB } from "../src/db/client";

/**
 * A fresh, isolated in-memory database with the real migrations applied.
 * Tests run against the actual Drizzle schema — no mocking the data layer.
 */
export function createTestDb(): DB {
  const db = createDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
