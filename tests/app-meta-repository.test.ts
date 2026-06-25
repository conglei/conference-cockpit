import { describe, it, expect, beforeEach } from "vitest";
import {
  createAppMetaRepo,
  LAST_REFRESH_AT,
  type AppMetaRepo,
} from "../src/db/app-meta-repository";
import { createTestDb } from "./helpers";

describe("app_meta repository", () => {
  let repo: AppMetaRepo;

  beforeEach(() => {
    repo = createAppMetaRepo(createTestDb());
  });

  it("returns undefined for an unset key", () => {
    expect(repo.get("nope")).toBeUndefined();
    expect(repo.getRow("nope")).toBeUndefined();
    expect(repo.getLastRefreshAt()).toBeUndefined();
  });

  it("sets and gets a key/value with an updated_at stamp", () => {
    repo.set("foo", "bar", 1000);
    expect(repo.get("foo")).toBe("bar");
    const row = repo.getRow("foo");
    expect(row?.value).toBe("bar");
    expect(row?.updatedAt).toBe(1000);
  });

  it("upserts on the key (idempotent, no duplicate rows)", () => {
    repo.set("foo", "one", 1000);
    repo.set("foo", "two", 2000);
    expect(repo.get("foo")).toBe("two");
    expect(repo.getRow("foo")?.updatedAt).toBe(2000);
  });

  it("persists last_refresh_at as a number under the well-known key", () => {
    repo.setLastRefreshAt(1_700_000_000_000);
    expect(repo.getLastRefreshAt()).toBe(1_700_000_000_000);
    // stored as a string under the canonical key
    expect(repo.get(LAST_REFRESH_AT)).toBe("1700000000000");
  });

  it("ignores a non-numeric last_refresh_at value gracefully", () => {
    repo.set(LAST_REFRESH_AT, "not-a-number");
    expect(repo.getLastRefreshAt()).toBeUndefined();
  });
});
