import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, DB_URL } from "../src/db/client";

const db = createDb(DB_URL);
migrate(db, { migrationsFolder: "drizzle" });
console.log(`✓ Migrated database at ${DB_URL}`);
