import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "../src/onboarding/load-env";

// Plain string maps stand in for process.env; cast at the call boundary so we
// don't have to satisfy the stricter NodeJS.ProcessEnv shape (NODE_ENV etc.).
type Env = Record<string, string | undefined>;
const asProcessEnv = (e: Env) => e as NodeJS.ProcessEnv;

describe("loadEnvFile", () => {
  it("loads file values into the env, filling gaps", () => {
    const dir = mkdtempSync(join(tmpdir(), "loadenv-"));
    const file = join(dir, ".env.local");
    writeFileSync(file, "ENRICHMENT_PROVIDER=harvest\nHARVESTAPI_KEY=from-file");
    try {
      const env: Env = {};
      loadEnvFile(asProcessEnv(env), file);
      expect(env.ENRICHMENT_PROVIDER).toBe("harvest");
      expect(env.HARVESTAPI_KEY).toBe("from-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never overrides a value already present in the env (real env wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "loadenv-"));
    const file = join(dir, ".env.local");
    writeFileSync(file, "ENRICHMENT_PROVIDER=from-file\nSEARCHAPI_KEY=from-file");
    try {
      const env: Env = { ENRICHMENT_PROVIDER: "from-proc" };
      loadEnvFile(asProcessEnv(env), file);
      expect(env.ENRICHMENT_PROVIDER).toBe("from-proc"); // process wins
      expect(env.SEARCHAPI_KEY).toBe("from-file"); // file fills the gap
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates a missing file (no throw, no mutation)", () => {
    const env: Env = { FOO: "bar" };
    expect(() => loadEnvFile(asProcessEnv(env), "/no/such/.env.local")).not.toThrow();
    expect(env).toEqual({ FOO: "bar" });
  });

  it("honors ENV_FILE on the passed env as the default path", () => {
    const dir = mkdtempSync(join(tmpdir(), "loadenv-"));
    const file = join(dir, "custom.env");
    writeFileSync(file, "HARVESTAPI_KEY=via-env-file");
    try {
      const env: Env = { ENV_FILE: file };
      loadEnvFile(asProcessEnv(env));
      expect(env.HARVESTAPI_KEY).toBe("via-env-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
