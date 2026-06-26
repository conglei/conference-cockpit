import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, DB_URL } from "../src/db/client";

const db = createDb(DB_URL);
await migrate(db, { migrationsFolder: "drizzle" });
console.log(`✓ Migrated database at ${DB_URL}`);
