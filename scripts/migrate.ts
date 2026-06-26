import { migrate } from "drizzle-orm/libsql/migrator";
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, resolveDbUrl } from "../src/db/client";

// Load .env.local so a configured DATABASE_URL (e.g. Turso) is honored — without
// this, migrate only ever targets the local file fallback.
loadEnvFile();
const db = createDb();
await migrate(db, { migrationsFolder: "drizzle" });
console.log(`✓ Migrated database at ${resolveDbUrl()}`);
