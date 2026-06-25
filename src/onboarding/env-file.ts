import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env parser (no new runtime deps). Supports `KEY=value`,
 * `export KEY=value`, `#` comments, blank lines, and single/double quoted
 * values. This is only used to *read* a provider key file for the env-check
 * readout; it does NOT mutate process.env.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;

    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (key === "") continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read a .env file into a map, returning {} if it does not exist.
 */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

/**
 * Build the effective env for the check: values from process.env take
 * precedence over the .env.local file (mirrors how the app actually resolves
 * config), but file values fill in anything not already exported.
 */
export function resolveEnv(
  processEnv: Record<string, string | undefined>,
  envFilePath: string,
): Record<string, string | undefined> {
  return { ...readEnvFile(envFilePath), ...processEnv };
}
