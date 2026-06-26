import { describe, it, expect, afterEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createReadOnlyDb } from "../src/db/client";
import { createCompanyRepo } from "../src/db/repository";

/**
 * ADR-0005: the agent's exploration handle must not be able to write. libSQL has
 * no connection-level read-only flag, so `createReadOnlyDb` enforces it at the
 * seam — reads pass through, every write method throws.
 */
describe("createReadOnlyDb (ADR-0005 read-only invariant)", () => {
  const dbs: string[] = [];
  function tmpDbPath(): string {
    const p = join(tmpdir(), `ro-test-${Date.now()}-${dbs.length}.db`);
    dbs.push(p);
    return p;
  }
  afterEach(() => {
    for (const p of dbs.splice(0)) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        try {
          rmSync(f);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("reads through but blocks writes attempted via a repo", async () => {
    const path = tmpDbPath();
    // Seed through a NORMAL handle (migrate + a write both succeed).
    const writable = createDb(path);
    await migrate(writable, { migrationsFolder: "drizzle" });
    await createCompanyRepo(writable).create({ slug: "acme", name: "Acme", status: "new" });

    // The read-only handle sees the data...
    const ro = createReadOnlyDb(path);
    const list = await createCompanyRepo(ro).list();
    expect(list.map((c) => c.slug)).toEqual(["acme"]);

    // ...but cannot write (the repo's create uses db.insert).
    await expect(
      createCompanyRepo(ro).create({ slug: "x", name: "X", status: "new" }),
    ).rejects.toThrow(/read-only/);
  });

  it("blocks the mutating Drizzle methods directly", () => {
    const ro = createReadOnlyDb(tmpDbPath());
    expect(() => ro.insert({} as never)).toThrow(/read-only/);
    expect(() => ro.update({} as never)).toThrow(/read-only/);
    expect(() => ro.delete({} as never)).toThrow(/read-only/);
  });
});
