/**
 * Rebuild a runnable conference DB from the committed demo snapshot
 * (`seed/demo-snapshot.json`) so a fresh clone can run the demo with no API keys
 * and no 28 MB working DB. Migrates the schema, then bulk-inserts the snapshot
 * preserving ids (so FK links hold). Refuses to clobber a populated DB unless
 * `--force` is passed.
 *
 *   pnpm seed-demo            # into DATABASE_URL (or data/conference.db)
 *   pnpm seed-demo --force    # wipe + reseed even if rows exist
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { ensureDb } from "../src/onboarding/ensure-db";
import { DB_URL } from "../src/db/client";

const TABLES = ["companies", "people", "talks", "roles"] as const;

function insertAll(db: Database.Database, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
  );
  const tx = db.transaction((rs: Record<string, unknown>[]) => {
    for (const r of rs) stmt.run(cols.map((c) => r[c] ?? null));
  });
  tx(rows);
  return rows.length;
}

function main() {
  const force = process.argv.includes("--force");
  const url = DB_URL;

  // Schema first (idempotent), then a raw handle for fast bulk insert.
  ensureDb(url);
  const db = new Database(url);
  db.pragma("foreign_keys = ON");

  const existing = (db.prepare("SELECT COUNT(*) n FROM companies").get() as { n: number }).n;
  if (existing > 0) {
    if (!force) {
      console.error(
        `Refusing to seed: ${existing} companies already present. Re-run with --force to wipe + reseed.`,
      );
      process.exit(1);
    }
    db.exec("PRAGMA foreign_keys=OFF; DELETE FROM roles; DELETE FROM talks; DELETE FROM people; DELETE FROM companies; PRAGMA foreign_keys=ON;");
  }

  const snap = JSON.parse(readFileSync("seed/demo-snapshot.json", "utf8")) as Record<
    string,
    Record<string, unknown>[]
  >;
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = insertAll(db, t, snap[t] ?? []);

  console.log(
    `Seeded ${url} from demo snapshot — ` +
      TABLES.map((t) => `${counts[t]} ${t}`).join(", "),
  );
  db.close();
}

main();
