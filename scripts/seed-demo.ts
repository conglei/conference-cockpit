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
import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDb } from "../src/onboarding/ensure-db";
import { DB_URL } from "../src/db/client";

const TABLES = ["companies", "people", "talks", "roles"] as const;

/** Mirror the driver's URL mapping so bare paths become file: URLs. */
function toLibsqlUrl(url: string): string {
  if (url === ":memory:") return ":memory:";
  if (/^(file|libsql|https?|wss?):/.test(url)) return url;
  mkdirSync(dirname(url), { recursive: true });
  return `file:${url}`;
}

async function insertAll(
  client: Client,
  table: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
  const stmts = rows.map((r) => ({
    sql,
    args: cols.map((c) => (r[c] ?? null) as InValue),
  }));
  await client.batch(stmts, "write");
  return rows.length;
}

async function main() {
  const force = process.argv.includes("--force");
  const url = DB_URL;

  // Schema first (idempotent), then a raw client for fast bulk insert.
  await ensureDb(url);
  const client = createClient({
    url: toLibsqlUrl(url),
    authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN,
  });

  const existing = Number(
    (await client.execute("SELECT COUNT(*) n FROM companies")).rows[0].n,
  );
  if (existing > 0) {
    if (!force) {
      console.error(
        `Refusing to seed: ${existing} companies already present. Re-run with --force to wipe + reseed.`,
      );
      process.exit(1);
    }
    await client.batch(
      [
        "PRAGMA foreign_keys=OFF",
        "DELETE FROM roles",
        "DELETE FROM talks",
        "DELETE FROM people",
        "DELETE FROM companies",
        "PRAGMA foreign_keys=ON",
      ],
      "write",
    );
  }

  const snap = JSON.parse(readFileSync("seed/demo-snapshot.json", "utf8")) as Record<
    string,
    Record<string, unknown>[]
  >;
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = await insertAll(client, t, snap[t] ?? []);

  console.log(
    `Seeded ${url} from demo snapshot — ` +
      TABLES.map((t) => `${counts[t]} ${t}`).join(", "),
  );
  client.close();
}

await main();
