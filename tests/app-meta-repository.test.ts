import { describe, it, expect, beforeEach } from "vitest";
import {
  createAppMetaRepo,
  LAST_REFRESH_AT,
  type AppMetaRepo,
} from "../src/db/app-meta-repository";
import { createTestDb } from "./helpers";

describe("app_meta repository", () => {
  let repo: AppMetaRepo;

  beforeEach(async () => {
    repo = createAppMetaRepo(await createTestDb());
  });

  it("returns undefined for an unset key", async () => {
    expect(await repo.get("nope")).toBeUndefined();
    expect(await repo.getRow("nope")).toBeUndefined();
    expect(await repo.getLastRefreshAt()).toBeUndefined();
  });

  it("sets and gets a key/value with an updated_at stamp", async () => {
    await repo.set("foo", "bar", 1000);
    expect(await repo.get("foo")).toBe("bar");
    const row = await repo.getRow("foo");
    expect(row?.value).toBe("bar");
    expect(row?.updatedAt).toBe(1000);
  });

  it("upserts on the key (idempotent, no duplicate rows)", async () => {
    await repo.set("foo", "one", 1000);
    await repo.set("foo", "two", 2000);
    expect(await repo.get("foo")).toBe("two");
    expect((await repo.getRow("foo"))?.updatedAt).toBe(2000);
  });

  it("persists last_refresh_at as a number under the well-known key", async () => {
    await repo.setLastRefreshAt(1_700_000_000_000);
    expect(await repo.getLastRefreshAt()).toBe(1_700_000_000_000);
    // stored as a string under the canonical key
    expect(await repo.get(LAST_REFRESH_AT)).toBe("1700000000000");
  });

  it("ignores a non-numeric last_refresh_at value gracefully", async () => {
    await repo.set(LAST_REFRESH_AT, "not-a-number");
    expect(await repo.getLastRefreshAt()).toBeUndefined();
  });
});
