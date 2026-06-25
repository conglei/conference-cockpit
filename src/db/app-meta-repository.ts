/**
 * The typed data layer for `app_meta` — a tiny key/value store for runtime state
 * the daily routine needs (issue 11). All access goes through here; no raw SQL
 * elsewhere (ADR-0001).
 *
 * Its load-bearing key is `last_refresh_at`: the unix-epoch-ms timestamp of the
 * last successful `refresh`. The `daily` skill reads it to answer "what's new
 * since the last run", and `refresh` writes it when it finishes. Keeping it in
 * the DB (rather than a file or env) means a headless refresh and an interactive
 * `daily` agree on the same watermark.
 */
import { eq } from "drizzle-orm";
import type { DB } from "./client";
import { appMeta, type AppMeta } from "./schema";

/** The well-known key holding the last successful refresh timestamp (ms). */
export const LAST_REFRESH_AT = "last_refresh_at";

export function createAppMetaRepo(db: DB) {
  return {
    /** Read a raw string value for a key, or undefined if unset. */
    get(key: string): string | undefined {
      const row = db.select().from(appMeta).where(eq(appMeta.key, key)).get();
      return row?.value ?? undefined;
    },

    /** The full row (value + updated_at) for a key, or undefined if unset. */
    getRow(key: string): AppMeta | undefined {
      return db.select().from(appMeta).where(eq(appMeta.key, key)).get();
    },

    /**
     * Upsert a key/value, stamping `updated_at`. Idempotent on the key (the
     * primary key), so repeated sets overwrite rather than duplicate.
     */
    set(key: string, value: string, now: number = Date.now()): void {
      db
        .insert(appMeta)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: appMeta.key,
          set: { value, updatedAt: now },
        })
        .run();
    },

    /** Read `last_refresh_at` as a number (ms), or undefined if never set. */
    getLastRefreshAt(): number | undefined {
      const raw = this.get(LAST_REFRESH_AT);
      if (raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    },

    /** Persist `last_refresh_at` (ms since epoch). */
    setLastRefreshAt(ts: number = Date.now()): void {
      this.set(LAST_REFRESH_AT, String(ts), ts);
    },
  };
}

export type AppMetaRepo = ReturnType<typeof createAppMetaRepo>;
