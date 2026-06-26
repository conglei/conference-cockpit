import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProviderTiers,
  formatEnvCheck,
} from "../src/onboarding/env-check";
import { parseEnvFile, resolveEnv } from "../src/onboarding/env-file";
import {
  ingestResume,
  ingestResumeFromPath,
  scaffoldPreferences,
  scaffoldNarrative,
  scaffoldProfileDocs,
  RESUME_PATH,
  PREFERENCES_PATH,
  NARRATIVE_PATH,
} from "../src/onboarding/profile";
import { ensureDb } from "../src/onboarding/ensure-db";
import { createCompanyRepo } from "../src/db/repository";

describe("env-check tier detection", () => {
  it("reports both tiers inactive on an empty env, with precise hints", () => {
    const result = detectProviderTiers({});
    expect(result.activeCount).toBe(0);
    expect(result.tiers).toHaveLength(2);

    const harvest = result.tiers.find((t) => t.id === "harvestapi")!;
    const search = result.tiers.find((t) => t.id === "searchapi")!;

    expect(harvest.active).toBe(false);
    expect(harvest.hint).toContain("HARVESTAPI_KEY");
    expect(harvest.hint).toContain(".env.local");

    expect(search.active).toBe(false);
    expect(search.hint).toContain("SEARCHAPI_KEY");
  });

  it("marks a tier active when its key is set and non-empty", () => {
    const result = detectProviderTiers({ HARVESTAPI_KEY: "abc123" });
    const harvest = result.tiers.find((t) => t.id === "harvestapi")!;
    const search = result.tiers.find((t) => t.id === "searchapi")!;

    expect(result.activeCount).toBe(1);
    expect(harvest.active).toBe(true);
    expect(harvest.hint).toBeUndefined();
    expect(search.active).toBe(false);
  });

  it("treats blank/whitespace values as unset", () => {
    const result = detectProviderTiers({ HARVESTAPI_KEY: "   ", SEARCHAPI_KEY: "" });
    expect(result.activeCount).toBe(0);
    expect(result.tiers.every((t) => !t.active)).toBe(true);
  });

  it("reports all active when both keys are set", () => {
    const result = detectProviderTiers({
      HARVESTAPI_KEY: "k1",
      SEARCHAPI_KEY: "k2",
    });
    expect(result.activeCount).toBe(2);
    expect(result.tiers.every((t) => t.active)).toBe(true);
  });

  it("formatter names missing env vars in the readout", () => {
    const out = formatEnvCheck(detectProviderTiers({ SEARCHAPI_KEY: "k2" }));
    expect(out).toContain("1 of 2");
    expect(out).toContain("HARVESTAPI_KEY"); // the missing one is surfaced
    expect(out).toContain("[active]");
    expect(out).toContain("[inactive]");
  });
});

describe("env-file parsing", () => {
  it("parses KEY=value, export, comments, and quotes", () => {
    const parsed = parseEnvFile(
      [
        "# a comment",
        "",
        "HARVESTAPI_KEY=abc",
        'export SEARCHAPI_KEY="quoted value"',
        "BLANK=",
        "  SPACED = trimmed ",
      ].join("\n"),
    );
    expect(parsed.HARVESTAPI_KEY).toBe("abc");
    expect(parsed.SEARCHAPI_KEY).toBe("quoted value");
    expect(parsed.BLANK).toBe("");
    expect(parsed.SPACED).toBe("trimmed");
  });

  it("resolveEnv lets process.env override the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "envfile-"));
    const file = join(dir, ".env.local");
    writeFileSync(file, "HARVESTAPI_KEY=from-file\nSEARCHAPI_KEY=from-file");
    try {
      const env = resolveEnv({ HARVESTAPI_KEY: "from-proc" }, file);
      expect(env.HARVESTAPI_KEY).toBe("from-proc"); // process wins
      expect(env.SEARCHAPI_KEY).toBe("from-file"); // file fills the gap
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveEnv tolerates a missing file", () => {
    const env = resolveEnv({ FOO: "bar" }, "/no/such/.env.local");
    expect(env.FOO).toBe("bar");
  });
});

describe("résumé ingest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "resume-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes profile/resume.md from a pasted string", () => {
    const path = ingestResume("# Jane Doe\n\nSenior Engineer", { baseDir: dir });
    expect(path).toBe(join(dir, RESUME_PATH));
    const written = readFileSync(path, "utf8");
    expect(written).toContain("Jane Doe");
    expect(written.endsWith("\n")).toBe(true);
  });

  it("ingests from a text file path", () => {
    const src = join(dir, "cv.txt");
    writeFileSync(src, "Plain text resume");
    const path = ingestResumeFromPath(src, { baseDir: dir });
    expect(readFileSync(path, "utf8")).toContain("Plain text resume");
  });

  it("rejects binary formats (PDF/DOCX out of scope)", () => {
    expect(() => ingestResumeFromPath("/x/resume.pdf", { baseDir: dir })).toThrow(
      /out of scope/i,
    );
    expect(() => ingestResumeFromPath("/x/resume.docx", { baseDir: dir })).toThrow();
  });

  it("throws a clear error for a missing file", () => {
    expect(() => ingestResumeFromPath(join(dir, "nope.txt"), { baseDir: dir })).toThrow(
      /not found/i,
    );
  });
});

describe("profile scaffolds", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scaffold-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes preferences.md with co-dominant founder/investor weights", () => {
    const { path, created } = scaffoldPreferences({ baseDir: dir });
    expect(created).toBe(true);
    expect(path).toBe(join(dir, PREFERENCES_PATH));
    const body = readFileSync(path, "utf8");
    expect(body).toContain("founder_quality");
    expect(body).toContain("investor_quality");
    expect(body.toLowerCase()).toContain("co-dominant");
  });

  it("writes narrative.md", () => {
    const { path, created } = scaffoldNarrative({ baseDir: dir });
    expect(created).toBe(true);
    expect(path).toBe(join(dir, NARRATIVE_PATH));
    expect(readFileSync(path, "utf8")).toContain("# Narrative");
  });

  it("does not clobber existing files unless forced", () => {
    scaffoldPreferences({ baseDir: dir });
    writeFileSync(join(dir, PREFERENCES_PATH), "MY EDITS");

    const again = scaffoldPreferences({ baseDir: dir });
    expect(again.created).toBe(false);
    expect(readFileSync(join(dir, PREFERENCES_PATH), "utf8")).toBe("MY EDITS");

    const forced = scaffoldPreferences({ baseDir: dir, force: true });
    expect(forced.created).toBe(true);
    expect(readFileSync(join(dir, PREFERENCES_PATH), "utf8")).not.toBe("MY EDITS");
  });

  it("scaffoldProfileDocs writes both docs", () => {
    const r = scaffoldProfileDocs({ baseDir: dir });
    expect(r.preferences.created).toBe(true);
    expect(r.narrative.created).toBe(true);
    expect(existsSync(join(dir, PREFERENCES_PATH))).toBe(true);
    expect(existsSync(join(dir, NARRATIVE_PATH))).toBe(true);
  });
});

describe("ensureDb", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ensuredb-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a migrated DB and is idempotent", async () => {
    const dbPath = join(dir, "test.db");

    const db1 = await ensureDb(dbPath);
    // schema is usable -> a repo query works against the migrated DB
    const repo1 = createCompanyRepo(db1);
    await repo1.create({ slug: "acme", name: "Acme" });
    expect(await repo1.list()).toHaveLength(1);
    expect(existsSync(dbPath)).toBe(true);

    // Running again against the same path is a no-op (migrations already applied)
    // and data persists.
    await expect(ensureDb(dbPath)).resolves.not.toThrow();
    const repo2 = createCompanyRepo(await ensureDb(dbPath));
    expect(await repo2.list()).toHaveLength(1);
  });

  it("works against an in-memory DB", async () => {
    const db = await ensureDb(":memory:");
    await expect(createCompanyRepo(db).list()).resolves.not.toThrow();
  });
});
