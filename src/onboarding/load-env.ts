import { readEnvFile } from "./env-file";

/**
 * Load `.env.local` into process.env for the operational CLIs.
 *
 * tsx does NOT auto-load `.env` files, so without this the provider factory
 * (`createProvider`, reads ENRICHMENT_PROVIDER) and the HarvestAPI/SearchAPI
 * adapters (read HARVESTAPI_KEY / SEARCHAPI_KEY) silently fall back to the
 * `fake` provider even when `.env.local` is correctly configured. The
 * `env-check`/`onboard` paths sidestep this by reading the file directly via
 * `resolveEnv`; every other script must call this first.
 *
 * Precedence mirrors `resolveEnv`: a value already present in `processEnv` (a
 * real exported env var) always wins; file values only fill in the gaps. The
 * file path is overridable via the ENV_FILE env var to match `env-check.ts`.
 *
 * Call this once, before any provider is constructed:
 *   import { loadEnvFile } from "../src/onboarding/load-env";
 *   loadEnvFile();
 */
export function loadEnvFile(
  processEnv: NodeJS.ProcessEnv = process.env,
  envFilePath: string = processEnv.ENV_FILE ?? ".env.local",
): void {
  const fileEnv = readEnvFile(envFilePath);
  for (const [key, value] of Object.entries(fileEnv)) {
    if (processEnv[key] === undefined) {
      processEnv[key] = value;
    }
  }
}
