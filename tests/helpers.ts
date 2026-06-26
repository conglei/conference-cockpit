import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, type DB } from "../src/db/client";

/**
 * A fresh, isolated in-memory database with the real migrations applied.
 * Tests run against the actual Drizzle schema — no mocking the data layer.
 */
export async function createTestDb(): Promise<DB> {
  const db = createDb(":memory:");
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
